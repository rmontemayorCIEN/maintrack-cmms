// Contrato de administración, versión 1: cómo la Torre de Control administra
// las cuentas de clientes de cada app (empresas, despachos, espacios).
//
// ESTE ARCHIVO ES LA FUENTE. Cada app lleva una copia IGUAL en
// `lib/torre/administracion.ts` (o donde viva su `lib`); el guardián
// scripts/revisar-contrato.mjs de la Torre lo exige.
//
// UNA SOLA VERDAD: los datos viven en la app y la Torre NO guarda copia. Cada
// ruta llama a las MISMAS funciones que la pantalla del operador de la app, así
// que lo que se ve o cambia desde la Torre es lo mismo que en la app.
//
// Rutas (todas contestan 404 si la firma no vale o la app no tiene secreto):
//
//   GET /api/torre/admin/catalogo        → Catalogo
//   GET /api/torre/admin/cuentas         → ListaCuentas
//   GET /api/torre/admin/cuentas/<id>    → DetalleCuenta
//
// Firma: `Authorization: TorreAdmin <carga>.<firma>`. La carga dice para qué
// app, quién (la persona de la Torre), qué método y ruta, el resumen del cuerpo
// y cuándo vence (60 s). La firma es HMAC-SHA256 con un secreto que vive en
// Secret Manager como TORRE_ADMIN_SECRETO en la app y ADMIN_SECRETO_<CLAVE> en
// la Torre, con el MISMO valor, DISTINTO del token de salud: el de salud solo
// lee estados; este abre las cuentas de los clientes.
//
// Datos: SOLO lo de la cuenta como cliente de la plataforma (nombre, estado,
// plan, conteos, dinero, consumo). NUNCA correos, teléfonos, RFC, domicilios,
// contraseñas ni nada de los clientes de tus clientes. Cada consulta queda en la
// bitácora de la app a nombre de la persona que firmó.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ADMIN_VERSION = 1;
export const VIGENCIA_FIRMA_S = 60;
/// Tolerancia a relojes desfasados entre la Torre y la app.
const DESFASE_S = 30;

export const LIMITES = {
  cuentas: 500,
  extra: 12,
  secciones: 8,
  filas: 30,
  texto: 200,
  acciones: 20,
} as const;

/// Normalizado entre apps: cada una traduce el suyo (ACTIVO, TRIAL…).
export type EstadoCuenta = "ACTIVA" | "PRUEBA" | "SUSPENDIDA" | "CANCELADA";
export const ESTADOS_CUENTA: EstadoCuenta[] = ["ACTIVA", "PRUEBA", "SUSPENDIDA", "CANCELADA"];

export type TipoCampo = "texto" | "numero" | "dinero" | "fecha" | "si-no";

/// Una acción que la app ofrece (versión 1: se declaran, se ejecutan en la
/// fase siguiente). `delicada` pide confirmar escribiendo el nombre de la cuenta.
export type AccionDeclarada = {
  clave: string;
  nombre: string;
  explica: string;
  delicada: boolean;
  campos: {
    clave: string;
    nombre: string;
    tipo: "opcion" | "numero" | "texto" | "fecha";
    requerido: boolean;
    opciones?: { valor: string; nombre: string }[];
    min?: number;
    max?: number;
    largoMax?: number;
  }[];
};

export type Catalogo = {
  contrato: typeof ADMIN_VERSION;
  app: string;
  /// Cómo llama la app a sus cuentas: «despacho» / «despachos».
  cuentas: { singular: string; plural: string };
  /// Campos propios de la app, además de los comunes de Cuenta.
  campos: { clave: string; nombre: string; tipo: TipoCampo }[];
  acciones: AccionDeclarada[];
  /// Ruta DENTRO de la app donde el operador ve la cuenta, con «{id}»:
  /// «/admin/despachos/{id}». Lo que no está en la Torre se hace ahí.
  abrirEnApp: string | null;
};

export type Cuenta = {
  id: string;
  nombre: string;
  estado: EstadoCuenta;
  plan: string | null;
  pruebaHasta: string | null;
  creadaEn: string;
  usuarios: number | null;
  /// Última vez que alguien de la cuenta usó la app, si se registra.
  ultimoUso: string | null;
  /// Costo de IA del mes en curso, en dólares. null = la app no lo registra.
  iaMesUsd: number | null;
  /// Lo que debe la cuenta (vencido o no). null = la app no cobra por sí misma.
  saldo: number | null;
  moneda: "MXN" | "USD" | null;
  /// Los campos declarados en el catálogo.
  extra: Record<string, string | number | boolean | null>;
  /// Cambia cada vez que la cuenta cambia (por ejemplo, su updatedAt). Las
  /// acciones lo mandan de vuelta: si ya no coincide, alguien la cambió.
  version: string;
};

export type ListaCuentas = {
  contrato: typeof ADMIN_VERSION;
  app: string;
  generadoEn: string;
  /// Cuántas hay en total; la lista trae a lo más LIMITES.cuentas.
  total: number;
  cuentas: Cuenta[];
};

export type DetalleCuenta = {
  contrato: typeof ADMIN_VERSION;
  app: string;
  generadoEn: string;
  cuenta: Cuenta;
  /// Lo demás, ya en palabras: «Cobranza», «IA por función»… Sin datos personales.
  secciones: { titulo: string; filas: { nombre: string; valor: string }[] }[];
};

// ---------- Firma ----------

export type CargaFirma = {
  v: typeof ADMIN_VERSION;
  app: string;
  persona: { email: string; nombre: string };
  metodo: string;
  /// Ruta con su consulta: «/api/torre/admin/cuentas?x=1».
  ruta: string;
  /// SHA-256 del cuerpo en hexadecimal («» si no hay cuerpo).
  cuerpo: string;
  emitida: number;
  vence: number;
  /// Identificador único: las acciones lo usan para no ejecutarse dos veces.
  id: string;
};

const b64 = (x: Buffer | string) => Buffer.from(x).toString("base64url");
export const resumenCuerpo = (cuerpo: string) => (cuerpo ? createHash("sha256").update(cuerpo).digest("hex") : "");

/// Lo usa la Torre: arma el encabezado Authorization para una petición.
export function firmar(secreto: string, d: { app: string; persona: { email: string; nombre: string }; metodo: string; ruta: string; cuerpo?: string }, ahora = new Date()): string {
  if (!secreto || secreto.length < 32) throw new Error("Secreto de administración ausente o corto.");
  const t = Math.floor(ahora.getTime() / 1000);
  const carga: CargaFirma = {
    v: ADMIN_VERSION, app: d.app, persona: { email: d.persona.email.slice(0, 200), nombre: d.persona.nombre.slice(0, 120) },
    metodo: d.metodo.toUpperCase(), ruta: d.ruta, cuerpo: resumenCuerpo(d.cuerpo ?? ""), emitida: t, vence: t + VIGENCIA_FIRMA_S, id: randomUUID(),
  };
  const c = b64(JSON.stringify(carga));
  return `TorreAdmin ${c}.${b64(createHmac("sha256", secreto).update(c).digest())}`;
}

export type Verificacion = { ok: true; carga: CargaFirma } | { ok: false; motivo: string };

/// Lo usa la app: si la petición viene firmada por la Torre, para ella, para
/// esta ruta y este cuerpo, y sigue vigente. El motivo es para la bitácora de
/// la app; al que pregunta siempre se le contesta 404.
export function verificar(req: { method: string; url: string; headers: { get(n: string): string | null } }, cuerpo: string, app: string, ahora = new Date()): Verificacion {
  const secreto = process.env.TORRE_ADMIN_SECRETO;
  if (!secreto || secreto.length < 32) return { ok: false, motivo: "sin secreto configurado" };
  const m = /^TorreAdmin ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return { ok: false, motivo: "sin firma" };
  const esperada = createHmac("sha256", secreto).update(m[1]!).digest();
  const dada = Buffer.from(m[2]!, "base64url");
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return { ok: false, motivo: "firma inválida" };
  let carga: CargaFirma;
  try { carga = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")); } catch { return { ok: false, motivo: "carga ilegible" }; }
  const t = Math.floor(ahora.getTime() / 1000);
  if (carga.v !== ADMIN_VERSION) return { ok: false, motivo: "versión desconocida" };
  if (carga.app !== app) return { ok: false, motivo: "firmada para otra app" };
  if (typeof carga.vence !== "number" || carga.vence < t || carga.emitida > t + DESFASE_S || carga.vence - carga.emitida > VIGENCIA_FIRMA_S) return { ok: false, motivo: "firma vencida" };
  const u = new URL(req.url);
  if (carga.metodo !== req.method.toUpperCase() || carga.ruta !== u.pathname + u.search) return { ok: false, motivo: "firmada para otra ruta" };
  if (carga.cuerpo !== resumenCuerpo(cuerpo)) return { ok: false, motivo: "el cuerpo no coincide" };
  if (!carga.persona?.email) return { ok: false, motivo: "sin persona" };
  return { ok: true, carga };
}

// ---------- Respuestas ----------

const recortar = (x: string, n: number = LIMITES.texto) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);

/// Recorta lo que la app arma a los límites del contrato antes de mandarlo.
export function limpiarCuenta(c: Cuenta): Cuenta {
  return {
    ...c,
    nombre: recortar(c.nombre),
    plan: c.plan === null ? null : recortar(c.plan, 80),
    extra: Object.fromEntries(Object.entries(c.extra).slice(0, LIMITES.extra).map(([k, v]) => [k, typeof v === "string" ? recortar(v) : v])),
  };
}

export function armarLista(app: string, cuentas: Cuenta[], total: number, ahora = new Date()): ListaCuentas {
  return { contrato: ADMIN_VERSION, app, generadoEn: ahora.toISOString(), total, cuentas: cuentas.slice(0, LIMITES.cuentas).map(limpiarCuenta) };
}

export function armarDetalle(app: string, cuenta: Cuenta, secciones: DetalleCuenta["secciones"], ahora = new Date()): DetalleCuenta {
  return {
    contrato: ADMIN_VERSION, app, generadoEn: ahora.toISOString(), cuenta: limpiarCuenta(cuenta),
    secciones: secciones.slice(0, LIMITES.secciones).map((s) => ({ titulo: recortar(s.titulo, 80), filas: s.filas.slice(0, LIMITES.filas).map((f) => ({ nombre: recortar(f.nombre, 80), valor: recortar(f.valor) })) })),
  };
}

/// JSON sin caché. El 404 no dice por qué: quien no es la Torre no aprende nada.
export function responder(datos: unknown, status = 200): Response {
  return new Response(status === 404 ? "No encontrado" : JSON.stringify(datos), {
    status,
    headers: { "content-type": status === 404 ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const fecha = (d: Date | null | undefined) => (d ? d.toISOString() : null);
