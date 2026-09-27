/**
 * OAuth 2.1 para el servidor MCP del operador.
 *
 * ── Para que existe ──
 *
 * Los conectores personalizados de claude.ai hablan OAuth: descubren el
 * servidor de autorizacion, se registran solos (RFC 7591), mandan al operador
 * a iniciar sesion y reciben un token. Aqui vive TODO lo que decide si un token
 * vale; las rutas solo traducen HTTP.
 *
 * ── Lo que se decidio y por que ──
 *
 * - **Tokens opacos guardados por su huella**, no JWT. Un JWT de una hora no se
 *   puede retirar; uno opaco se revisa contra la base en cada llamada, igual
 *   que la sesion de la aplicacion (lib/auth.ts).
 * - **PKCE S256 obligatorio**, para todos los clientes. OAuth 2.1 lo exige y es
 *   lo que protege el codigo si alguien lo ve pasar.
 * - **Direcciones de regreso de una lista cerrada.** El registro dinamico es
 *   publico por diseño —claude.ai lo necesita—, pero registrarse no le sirve a
 *   nadie si el codigo solo puede volver a claude.ai.
 * - **Solo el operador de la plataforma.** Se revisa al autorizar y OTRA VEZ en
 *   cada llamada: si se le retira el privilegio, el token deja de servir sin
 *   esperar a que venza.
 * - **«Cerrar sesion en todos lados» tambien desconecta al agente**: el token
 *   se compara contra User.sessionsValidFrom, la misma fecha que revoca las
 *   sesiones del navegador.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";

/** Cuanto vive cada cosa. */
export const VIDA_CODIGO_MS = 5 * 60_000;
export const VIDA_ACCESO_MS = 60 * 60_000;
export const VIDA_RENOVACION_MS = 30 * 24 * 60 * 60_000;

/** El unico alcance que existe: leer. No hay otro que pedir. */
export const ALCANCE = "lectura";

/**
 * A donde puede volver un codigo de autorizacion.
 *
 * Son las direcciones de regreso de los conectores de Claude. Cualquier otra
 * se rechaza al registrarse. `MCP_REDIRECT_EXTRA` (separadas por coma) existe
 * para probar con otro cliente sin tocar el codigo; en produccion no se pone.
 */
export const REGRESOS_PERMITIDOS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

export function regresosPermitidos(): string[] {
  const extra = (process.env.MCP_REDIRECT_EXTRA ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...REGRESOS_PERMITIDOS, ...extra];
}

/** Cuantos registros nuevos se aceptan por hora, entre todos. Es un endpoint sin sesion. */
export const TOPE_REGISTROS_POR_HORA = 30;

export class ErrorOAuth extends Error {
  constructor(
    /** El codigo de error de OAuth: invalid_request, invalid_grant... */
    public readonly error: string,
    mensaje: string,
    public readonly status = 400,
  ) {
    super(mensaje);
  }
}

export function huella(valor: string): string {
  return createHash("sha256").update(valor).digest("base64url");
}

function aleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function igualSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ─────────────────────────────────────────────────────────── direcciones ───

/**
 * El origen publico de la aplicacion.
 *
 * APP_URL manda cuando esta puesta. Sin ella se reconstruye de la peticion:
 * Cloud Run entrega el Host real y el protocolo en x-forwarded-proto.
 */
export function origenPublico(request: Request): string {
  return origenDe(request.headers, request.url);
}

/** Lo mismo desde las cabeceras, para una pagina que no recibe el Request. */
export function origenDe(cabeceras: Headers, urlPedida?: string): string {
  const fijo = process.env.APP_URL?.trim();
  if (fijo) return fijo.replace(/\/$/, "");
  const url = urlPedida ? new URL(urlPedida) : null;
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? url?.host;
  const proto = cabeceras.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url?.protocol.replace(":", "") ?? "https";
  return `${proto}://${host}`;
}

/** La URL del servidor MCP: el «recurso» de RFC 8707 y de RFC 9728. */
export function urlRecurso(origen: string): string {
  return `${origen}/api/mcp`;
}

/** Metadatos del recurso protegido (RFC 9728). */
export function metadatosRecurso(origen: string) {
  return {
    resource: urlRecurso(origen),
    authorization_servers: [origen],
    scopes_supported: [ALCANCE],
    bearer_methods_supported: ["header"],
    resource_name: "MainTrack — operador de la plataforma",
  };
}

/** Metadatos del servidor de autorizacion (RFC 8414). */
export function metadatosServidor(origen: string) {
  return {
    issuer: origen,
    authorization_endpoint: `${origen}/oauth/autorizar`,
    token_endpoint: `${origen}/api/oauth/token`,
    registration_endpoint: `${origen}/api/oauth/registro`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [ALCANCE],
  };
}

/** El recurso que pide el cliente, si lo pide, tiene que ser este servidor. */
export function validarRecurso(pedido: string | null | undefined, origen: string): string {
  const propio = urlRecurso(origen);
  if (!pedido) return propio;
  if (pedido.replace(/\/$/, "") !== propio) {
    throw new ErrorOAuth("invalid_target", "El recurso pedido no es este servidor.");
  }
  return propio;
}

// ──────────────────────────────────────────────────── registro dinamico ───

export type PeticionRegistro = {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
};

export async function registrarCliente(p: PeticionRegistro) {
  const uris = Array.isArray(p.redirect_uris) ? p.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length) throw new ErrorOAuth("invalid_redirect_uri", "Falta redirect_uris.");
  const permitidos = regresosPermitidos();
  const ajenas = uris.filter((u) => !permitidos.includes(u));
  if (ajenas.length) {
    throw new ErrorOAuth("invalid_redirect_uri", `Dirección de regreso no permitida: ${ajenas[0]}`);
  }

  const metodo = typeof p.token_endpoint_auth_method === "string" ? p.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(metodo)) {
    throw new ErrorOAuth("invalid_client_metadata", `Método de autenticación no admitido: ${metodo}`);
  }
  const tipos = Array.isArray(p.grant_types) ? p.grant_types : ["authorization_code"];
  if (tipos.some((t) => t !== "authorization_code" && t !== "refresh_token")) {
    throw new ErrorOAuth("invalid_client_metadata", "Solo se admiten authorization_code y refresh_token.");
  }

  const haceUnaHora = new Date(Date.now() - 60 * 60_000);
  const recientes = await prisma.clienteOAuth.count({ where: { createdAt: { gte: haceUnaHora } } });
  if (recientes >= TOPE_REGISTROS_POR_HORA) {
    throw new ErrorOAuth("temporarily_unavailable", "Demasiados registros en la última hora.", 429);
  }

  const nombre = (typeof p.client_name === "string" ? p.client_name : "Cliente MCP").trim().slice(0, 80) || "Cliente MCP";
  const clientId = `mcp_${aleatorio(18)}`;
  const secreto = metodo === "none" ? null : aleatorio(32);

  const cliente = await prisma.clienteOAuth.create({
    data: {
      clientId, nombre, metodoAuth: metodo,
      redirectUris: JSON.stringify(uris),
      huellaSecreto: secreto ? huella(secreto) : null,
    },
  });

  return {
    client_id: clientId,
    ...(secreto ? { client_secret: secreto, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(cliente.createdAt.getTime() / 1000),
    client_name: nombre,
    redirect_uris: uris,
    token_endpoint_auth_method: metodo,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: ALCANCE,
  };
}

export async function buscarCliente(clientId: string | null | undefined) {
  if (!clientId) return null;
  const c = await prisma.clienteOAuth.findUnique({ where: { clientId } });
  if (!c) return null;
  return { ...c, uris: JSON.parse(c.redirectUris) as string[] };
}

// ───────────────────────────────────────────────────────── autorizacion ───

export type PeticionAutorizacion = {
  response_type?: string | null;
  client_id?: string | null;
  redirect_uri?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  state?: string | null;
  resource?: string | null;
  scope?: string | null;
};

/** Los parametros de la autorizacion, en el orden en que viajan. */
export const CAMPOS_AUTORIZACION = [
  "response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope",
] as const;

/** Lee la peticion de autorizacion de la URL (la pantalla) o del formulario (el permiso). */
export function leerAutorizacion(fuente: URLSearchParams): PeticionAutorizacion {
  return Object.fromEntries(CAMPOS_AUTORIZACION.map((c) => [c, fuente.get(c)])) as PeticionAutorizacion;
}

/**
 * Revisa la peticion de autorizacion ANTES de mostrar nada.
 *
 * Hay dos clases de error y no se tratan igual. Si el cliente o la direccion
 * de regreso no son validos, NO se redirige a ningun lado —seria mandar a la
 * persona a una direccion que no se verifico—: se muestra el error aqui. Todo
 * lo demas se devuelve al cliente por la direccion ya verificada.
 */
export async function validarAutorizacion(p: PeticionAutorizacion, origen: string) {
  const cliente = await buscarCliente(p.client_id);
  if (!cliente) return { fatal: "La aplicación que pide acceso no está registrada." as const };
  if (!p.redirect_uri || !cliente.uris.includes(p.redirect_uri)) {
    return { fatal: "La dirección de regreso no corresponde a la aplicación registrada." as const };
  }
  const regreso = p.redirect_uri;
  const devolver = (error: string, descripcion: string) => ({ devolver: redireccion(regreso, { error, error_description: descripcion, state: p.state }) });

  if (p.response_type !== "code") return devolver("unsupported_response_type", "Solo se admite response_type=code.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") {
    return devolver("invalid_request", "PKCE con S256 es obligatorio.");
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge)) return devolver("invalid_request", "code_challenge mal formado.");
  let recurso: string;
  try {
    recurso = validarRecurso(p.resource, origen);
  } catch (e) {
    return devolver("invalid_target", (e as Error).message);
  }
  return { ok: { cliente, regreso, recurso, codeChallenge: p.code_challenge, state: p.state ?? null } };
}

export function redireccion(base: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

/** Emite el codigo, ya con la persona verificada como operador. */
export async function emitirCodigo(d: { clienteId: string; userId: string; regreso: string; codeChallenge: string; recurso: string }) {
  const codigo = aleatorio(32);
  await prisma.codigoOAuth.create({
    data: {
      huella: huella(codigo), clienteId: d.clienteId, userId: d.userId,
      redirectUri: d.regreso, codeChallenge: d.codeChallenge, recurso: d.recurso,
      expiraEl: new Date(Date.now() + VIDA_CODIGO_MS),
    },
  });
  return codigo;
}

// ─────────────────────────────────────────────────────────────── tokens ───

/** Autentica al cliente en el endpoint de tokens segun lo que declaro al registrarse. */
export async function autenticarCliente(form: URLSearchParams, authorization: string | null) {
  let clientId = form.get("client_id");
  let secreto = form.get("client_secret");
  if (authorization?.startsWith("Basic ")) {
    const [id, sec] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":");
    clientId = decodeURIComponent(id ?? "");
    secreto = decodeURIComponent(sec ?? "");
  }
  const cliente = await buscarCliente(clientId);
  if (!cliente) throw new ErrorOAuth("invalid_client", "Cliente desconocido.", 401);
  if (cliente.metodoAuth !== "none") {
    if (!secreto || !cliente.huellaSecreto || !igualSeguro(huella(secreto), cliente.huellaSecreto)) {
      throw new ErrorOAuth("invalid_client", "Credenciales del cliente inválidas.", 401);
    }
  }
  return cliente;
}

async function emitirPar(d: { clienteId: string; userId: string; recurso: string; familia: string; autorizadoEl: Date }) {
  const acceso = aleatorio(32);
  const renovacion = aleatorio(32);
  const ahora = Date.now();
  await prisma.tokenOAuth.createMany({
    data: [
      { huella: huella(acceso), tipo: "ACCESO", ...d, expiraEl: new Date(ahora + VIDA_ACCESO_MS) },
      { huella: huella(renovacion), tipo: "RENOVACION", ...d, expiraEl: new Date(ahora + VIDA_RENOVACION_MS) },
    ],
  });
  await prisma.clienteOAuth.update({ where: { id: d.clienteId }, data: { ultimoUsoEl: new Date() } });
  return {
    access_token: acceso,
    token_type: "Bearer",
    expires_in: Math.floor(VIDA_ACCESO_MS / 1000),
    refresh_token: renovacion,
    scope: ALCANCE,
  };
}

/** Si la persona sigue pudiendo usar el servidor. Se pregunta en cada canje y en cada llamada. */
export async function operadorVigente(userId: string, autorizadoEl: Date) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, active: true, isSuperAdmin: true, sessionsValidFrom: true, organizationId: true, name: true, email: true },
  });
  if (!u || !u.active) return { ok: false as const, status: 403 as const, motivo: "La cuenta ya no está activa.", usuario: u };
  if (!u.isSuperAdmin) return { ok: false as const, status: 403 as const, motivo: "Solo el operador de la plataforma puede usar este servidor.", usuario: u };
  // Misma resolucion que la sesion del navegador: al segundo.
  if (u.sessionsValidFrom && Math.floor(autorizadoEl.getTime() / 1000) < Math.floor(u.sessionsValidFrom.getTime() / 1000)) {
    // 401 y no 403: la persona sigue siendo operador, solo tiene que volver a
    // autorizar. Con 401 el cliente sabe que debe mandarla al inicio de sesion.
    return { ok: false as const, status: 401 as const, motivo: "Las sesiones de esta cuenta se cerraron; vuelva a conectar.", usuario: u };
  }
  return { ok: true as const, usuario: u };
}

export async function canjearCodigo(form: URLSearchParams, cliente: { id: string }, origen: string) {
  const codigo = form.get("code");
  const verificador = form.get("code_verifier");
  if (!codigo || !verificador) throw new ErrorOAuth("invalid_request", "Faltan code o code_verifier.");

  const registro = await prisma.codigoOAuth.findUnique({ where: { huella: huella(codigo) } });
  if (!registro || registro.clienteId !== cliente.id) throw new ErrorOAuth("invalid_grant", "Código inválido.");
  // Se marca usado ANTES de revisar lo demas, y de forma condicionada: dos
  // canjes simultaneos del mismo codigo no pueden ganar los dos.
  const marcado = await prisma.codigoOAuth.updateMany({ where: { id: registro.id, usadoEl: null }, data: { usadoEl: new Date() } });
  if (marcado.count !== 1) throw new ErrorOAuth("invalid_grant", "El código ya se usó.");
  if (registro.expiraEl.getTime() < Date.now()) throw new ErrorOAuth("invalid_grant", "El código venció.");
  if (form.get("redirect_uri") && form.get("redirect_uri") !== registro.redirectUri) {
    throw new ErrorOAuth("invalid_grant", "redirect_uri no coincide.");
  }
  if (!igualSeguro(huella(verificador), registro.codeChallenge)) throw new ErrorOAuth("invalid_grant", "PKCE no coincide.");
  const recurso = validarRecurso(form.get("resource") ?? registro.recurso, origen);
  if (recurso !== registro.recurso) throw new ErrorOAuth("invalid_target", "El recurso no coincide con el autorizado.");

  const autorizadoEl = registro.createdAt;
  const vigente = await operadorVigente(registro.userId, autorizadoEl);
  if (!vigente.ok) throw new ErrorOAuth("invalid_grant", vigente.motivo);

  return emitirPar({ clienteId: cliente.id, userId: registro.userId, recurso, familia: aleatorio(12), autorizadoEl });
}

export async function renovar(form: URLSearchParams, cliente: { id: string }, origen: string) {
  const valor = form.get("refresh_token");
  if (!valor) throw new ErrorOAuth("invalid_request", "Falta refresh_token.");
  const t = await prisma.tokenOAuth.findUnique({ where: { huella: huella(valor) } });
  if (!t || t.tipo !== "RENOVACION" || t.clienteId !== cliente.id) throw new ErrorOAuth("invalid_grant", "Token de renovación inválido.");
  if (t.revocadoEl) throw new ErrorOAuth("invalid_grant", "Token de renovación revocado.");

  const marcado = await prisma.tokenOAuth.updateMany({ where: { id: t.id, usadoEl: null }, data: { usadoEl: new Date() } });
  if (marcado.count !== 1) {
    // Reuso: alguien presento un token de renovacion que ya se canjeo. O se
    // copio, o lo tiene quien no debe. Se corta la familia completa.
    await revocarFamilia(t.familia);
    throw new ErrorOAuth("invalid_grant", "Token de renovación ya usado; se revocó el acceso.");
  }
  if (t.expiraEl.getTime() < Date.now()) throw new ErrorOAuth("invalid_grant", "Token de renovación vencido.");
  validarRecurso(form.get("resource") ?? t.recurso, origen);

  const vigente = await operadorVigente(t.userId, t.autorizadoEl);
  if (!vigente.ok) {
    await revocarFamilia(t.familia);
    throw new ErrorOAuth("invalid_grant", vigente.motivo);
  }
  return emitirPar({ clienteId: cliente.id, userId: t.userId, recurso: t.recurso, familia: t.familia, autorizadoEl: t.autorizadoEl });
}

export async function revocarFamilia(familia: string) {
  await prisma.tokenOAuth.updateMany({ where: { familia, revocadoEl: null }, data: { revocadoEl: new Date() } });
}

// ─────────────────────────────────────────────── el token en cada llamada ───

export type Agente = {
  userId: string;
  organizationId: string;
  nombre: string;
  correo: string;
  cliente: string;
};

export type Verificacion =
  | { ok: true; agente: Agente }
  /** Sin token o token que no sirve: 401, el cliente debe volver a autorizar. */
  | { ok: false; status: 401; motivo: string }
  /** Token bueno de alguien que no puede: 403. Lleva a quien, para la bitacora. */
  | { ok: false; status: 403; motivo: string; usuario?: { id: string; organizationId: string } };

export async function verificarToken(authorization: string | null, origen: string): Promise<Verificacion> {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(authorization?.trim() ?? "");
  if (!m) return { ok: false, status: 401, motivo: "Falta el token de acceso." };

  const t = await prisma.tokenOAuth.findUnique({
    where: { huella: huella(m[1]) },
    include: { cliente: { select: { nombre: true } } },
  });
  if (!t || t.tipo !== "ACCESO") return { ok: false, status: 401, motivo: "Token inválido." };
  if (t.revocadoEl) return { ok: false, status: 401, motivo: "Token revocado." };
  if (t.expiraEl.getTime() < Date.now()) return { ok: false, status: 401, motivo: "Token vencido." };
  // El token se emitio para ESTE servidor (RFC 8707). Uno emitido para otro
  // recurso no se acepta aunque este firmado por nosotros.
  if (t.recurso !== urlRecurso(origen)) return { ok: false, status: 401, motivo: "El token no es para este servidor." };

  const vigente = await operadorVigente(t.userId, t.autorizadoEl);
  if (!vigente.ok && vigente.status === 401) return { ok: false, status: 401, motivo: vigente.motivo };
  if (!vigente.ok) {
    return {
      ok: false, status: 403, motivo: vigente.motivo,
      usuario: vigente.usuario ? { id: vigente.usuario.id, organizationId: vigente.usuario.organizationId } : undefined,
    };
  }

  // El ultimo uso no se escribe en cada llamada: una vez por minuto basta
  // para saber si se esta usando, y no pone una escritura en cada lectura.
  if (!t.ultimoUsoEl || Date.now() - t.ultimoUsoEl.getTime() > 60_000) {
    await prisma.tokenOAuth.update({ where: { id: t.id }, data: { ultimoUsoEl: new Date() } }).catch(() => {});
  }

  const u = vigente.usuario;
  return { ok: true, agente: { userId: u.id, organizationId: u.organizationId, nombre: u.name, correo: u.email, cliente: t.cliente.nombre } };
}
