/**
 * El servidor MCP del operador: que solo entre quien debe, que no escriba
 * nada y que cada llamada quede en la bitacora.
 *
 * Recorre el flujo de verdad, por HTTP, como lo haria claude.ai: descubre los
 * metadatos, se registra, manda a la persona a autorizar, canjea el codigo con
 * PKCE, renueva, y llama cada herramienta. Nada de firmar tokens a mano: si el
 * endpoint de autorizacion dejara pasar a quien no es operador, esta prueba
 * lo tiene que ver.
 *
 *   npx tsx scripts/prueba-mcp.ts
 *
 * Usa la base de desarrollo y borra lo que crea. Deja en la carpeta temporal
 * un ejemplo de respuesta de cada herramienta (se imprime la ruta al final).
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import bcrypt from "bcryptjs";
import type { ChildProcess } from "node:child_process";
import { prisma } from "../lib/db";
import { apagarServidor, colaDelLog, levantarServidor } from "./servidor-de-prueba";
import { entrar, esperarServidor, fotoDeLasDemas } from "./apoyo-pruebas";
import { lectura, EscrituraRechazada } from "../lib/mcp/lectura";
import { destinoSeguro } from "../lib/mcp/destino";
import { buscarEnAyuda } from "../lib/mcp/documentacion";
import { nivelDeAdopcion } from "../lib/mcp/adopcion";
import { emitirCargosDelPeriodo } from "../lib/cobranza";

const PUERTO = 3237;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;
const REGRESO = "https://claude.ai/api/mcp/auth_callback";
const CLAVE = "Prueba-MCP-2026!";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien && d ? ` · ${d.slice(0, 300)}` : ""}`);
  if (!bien) fallas++;
}

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verificador = b64url(randomBytes(32));
  return { verificador, reto: b64url(createHash("sha256").update(verificador).digest()) };
}

async function http(metodo: string, ruta: string, opciones: { cab?: Record<string, string>; cuerpo?: string } = {}) {
  const r = await fetch(`${base}${ruta}`, { method: metodo, headers: opciones.cab, body: opciones.cuerpo, redirect: "manual" });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* no es json */ }
  return { status: r.status, cab: r.headers, texto, json };
}

const form = (d: Record<string, string>) => new URLSearchParams(d).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

async function main() {
  // ── Lo que no necesita servidor ─────────────────────────────────────────
  console.log("\nSolo lectura por construccion\n");
  let rechazo = "";
  try { await (lectura as unknown as typeof prisma).organization.update({ where: { id: "x" }, data: { name: "y" } }); } catch (e) { rechazo = e instanceof EscrituraRechazada ? "ok" : String(e); }
  revisar("el cliente de las herramientas rechaza un update", rechazo === "ok", rechazo);
  rechazo = "";
  try { await (lectura as unknown as typeof prisma).auditLog.deleteMany({}); } catch (e) { rechazo = e instanceof EscrituraRechazada ? "ok" : String(e); }
  revisar("…y un deleteMany", rechazo === "ok", rechazo);
  rechazo = "";
  try { await (lectura as unknown as typeof prisma).$executeRawUnsafe("DELETE FROM AuditLog"); } catch (e) { rechazo = e instanceof EscrituraRechazada ? "ok" : String(e); }
  revisar("…y el SQL crudo", rechazo === "ok", rechazo);
  rechazo = "";
  try { await (lectura as unknown as typeof prisma).$transaction([]); } catch (e) { rechazo = e instanceof EscrituraRechazada ? "ok" : String(e); }
  revisar("…y las transacciones", rechazo === "ok", rechazo);
  const leido = await lectura.organization.count();
  revisar("pero sí lee", typeof leido === "number");
  const fuente = readFileSync("lib/mcp/herramientas.ts", "utf8");
  revisar("las herramientas no importan prisma directo", !/from\s+["'](\.\.\/db|@\/lib\/db)["']/.test(fuente) && !/\bprisma\./.test(fuente));

  console.log("\nPiezas sueltas\n");
  revisar("el login regresa a la autorización", destinoSeguro("/oauth/autorizar?client_id=x") === "/oauth/autorizar?client_id=x");
  revisar("…pero no a otro sitio", destinoSeguro("//malo.com/oauth/") === "/dashboard" && destinoSeguro("https://malo.com") === "/dashboard" && destinoSeguro("/oauth/..//malo") === "/dashboard");
  revisar("…ni a cualquier ruta interna", destinoSeguro("/clients") === "/dashboard");
  const ayuda = buscarEnAyuda("¿Por qué no puedo cerrar una orden de trabajo?", 3);
  revisar("la búsqueda en la ayuda encuentra fichas", ayuda.resultados.length > 0, ayuda.terminosBuscados);
  revisar("una cuenta nueva sin uso está EN_ARRANQUE, no SIN_USO", nivelDeAdopcion(0, new Date()) === "EN_ARRANQUE");
  revisar("una cuenta vieja sin uso está SIN_USO", nivelDeAdopcion(0, new Date(Date.now() - 90 * 86_400_000)) === "SIN_USO");

  // ── Datos de la prueba ──────────────────────────────────────────────────
  const sello = `mcp-${Date.now()}`;
  const hash = await bcrypt.hash(CLAVE, 10);
  const propia = await prisma.organization.create({ data: { name: `Operador ${sello}`, slug: `op-${sello}`, timezone: "America/Monterrey" } });
  const cliente = await prisma.organization.create({ data: { name: `Cliente ${sello}`, slug: `cl-${sello}`, status: "TRIAL" } });
  // Una cuenta interna del operador: activa y pagando en apariencia, pero no es cliente.
  const interna = await prisma.organization.create({ data: { name: `Interna ${sello}`, slug: `in-${sello}`, status: "ACTIVE", cuentaInterna: true } });
  const operador = await prisma.user.create({ data: { organizationId: propia.id, email: `op-${sello}@prueba.mx`, name: "Operador", role: "OWNER", passwordHash: hash, isSuperAdmin: true } });
  const dueno = await prisma.user.create({ data: { organizationId: cliente.id, email: `dueno-${sello}@prueba.mx`, name: "Dueño", role: "OWNER", passwordHash: hash } });
  // Uso de IA con las tres unidades que conviven en la tabla.
  await prisma.aiUsage.createMany({ data: [
    { organizationId: cliente.id, userId: dueno.id, funcion: "DIAGNOSTICO", modelo: "claude-sonnet-5", inputTokens: 1000, outputTokens: 200, costoUsd: 0.01, periodo: "2026-09" },
    { organizationId: cliente.id, userId: dueno.id, funcion: "VOZ", modelo: "es-US-Neural2", inputTokens: 5000, operaciones: 0, costoUsd: 0.08, periodo: "2026-09" },
    { organizationId: cliente.id, userId: dueno.id, funcion: "DICTADO", modelo: "speech-v2", inputTokens: 45, costoUsd: 0.012, periodo: "2026-09", ok: false },
  ] });
  await prisma.auditLog.create({ data: { organizationId: cliente.id, userId: dueno.id, entity: "WorkOrder", entityId: "x", action: "CREATED" } });
  const nuestras = [propia.id, cliente.id, interna.id];

  console.log("\nCuenta interna\n");
  const cobro = await emitirCargosDelPeriodo("2026-09", { organizationId: interna.id });
  revisar("la cobranza no le genera cargo a una cuenta interna", cobro.emitidos === 0 && cobro.omitidos.some((o) => o.motivo.includes("Cuenta interna")), cobro);
  revisar("…y no quedó ninguna nota de cobro", (await prisma.invoice.count({ where: { organizationId: interna.id } })) === 0);
  const clientesCreados: string[] = [];

  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO, env: { APP_URL: base } });
  const ejemplos: Record<string, unknown> = {};

  try {
    await esperarServidor(base);
    const antes = await fotoDeLasDemas(nuestras);

    console.log("\nDescubrimiento\n");
    const pr = await http("GET", "/.well-known/oauth-protected-resource/api/mcp");
    revisar("metadatos del recurso", pr.status === 200 && pr.json.resource === `${base}/api/mcp`, pr.json);
    const pr2 = await http("GET", "/.well-known/oauth-protected-resource");
    revisar("…también en la raíz", pr2.status === 200 && pr2.json.resource === `${base}/api/mcp`);
    const as = await http("GET", "/.well-known/oauth-authorization-server");
    revisar("metadatos del servidor de autorización", as.status === 200 && as.json.registration_endpoint === `${base}/api/oauth/registro`
      && JSON.stringify(as.json.code_challenge_methods_supported) === '["S256"]', as.json);

    console.log("\nSin token no hay nada\n");
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } } });
    const sin = await http("POST", "/api/mcp", { cab: { "Content-Type": "application/json" }, cuerpo: init });
    revisar("sin token: 401", sin.status === 401, sin.status);
    revisar("…con la dirección de los metadatos", (sin.cab.get("www-authenticate") ?? "").includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"`), sin.cab.get("www-authenticate"));
    const falso = await http("POST", "/api/mcp", { cab: { "Content-Type": "application/json", Authorization: `Bearer ${b64url(randomBytes(32))}` }, cuerpo: init });
    revisar("token inventado: 401 invalid_token", falso.status === 401 && falso.json.error === "invalid_token", falso.json);
    const sesion = await entrar(base, operador.email, CLAVE);
    const conCookie = await http("POST", "/api/mcp", { cab: { "Content-Type": "application/json", ...sesion }, cuerpo: init });
    revisar("la cookie de sesión del operador NO sirve como token", conCookie.status === 401, conCookie.status);

    console.log("\nRegistro dinámico\n");
    const malo = await http("POST", "/api/oauth/registro", { cab: { "Content-Type": "application/json" }, cuerpo: JSON.stringify({ client_name: "Malo", redirect_uris: ["https://malo.com/cb"] }) });
    revisar("una dirección de regreso ajena se rechaza", malo.status === 400 && malo.json.error === "invalid_redirect_uri", malo.json);
    const reg = await http("POST", "/api/oauth/registro", { cab: { "Content-Type": "application/json" }, cuerpo: JSON.stringify({ client_name: "Claude", redirect_uris: [REGRESO], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }) });
    revisar("claude.ai se registra", reg.status === 201 && typeof reg.json.client_id === "string", reg.json);
    const clientId = reg.json.client_id as string;
    clientesCreados.push(clientId);

    const pedirCodigo = async (cab: Record<string, string>, decision = "permitir", origen = base) => {
      const { verificador, reto } = pkce();
      const params = { response_type: "code", client_id: clientId, redirect_uri: REGRESO, code_challenge: reto, code_challenge_method: "S256", state: "estado-123", resource: `${base}/api/mcp` };
      const pagina = await http("GET", `/oauth/autorizar?${form(params)}`, { cab });
      const post = await http("POST", "/api/oauth/autorizar", { cab: { ...cab, ...FORM, Origin: origen }, cuerpo: form({ ...params, decision }) });
      const destino = post.cab.get("location") ?? "";
      const codigo = destino.startsWith(REGRESO) ? new URL(destino).searchParams.get("code") : null;
      return { pagina, post, destino, codigo, verificador };
    };

    console.log("\nAutorización\n");
    const anonimo = await http("GET", `/oauth/autorizar?${form({ response_type: "code", client_id: clientId, redirect_uri: REGRESO, code_challenge: pkce().reto, code_challenge_method: "S256" })}`);
    revisar("sin sesión, la autorización manda al login y de regreso", [303, 307].includes(anonimo.status) && (anonimo.cab.get("location") ?? "").startsWith("/login?siguiente=%2Foauth%2Fautorizar"), anonimo.cab.get("location"));

    const noOp = await pedirCodigo(await entrar(base, dueno.email, CLAVE));
    revisar("un usuario que no es operador ve el aviso y no el botón", noOp.pagina.status === 200 && noOp.pagina.texto.includes("Solo el operador de la plataforma") && !noOp.pagina.texto.includes("Permitir"));
    revisar("…y si fuerza el formulario: 403 sin código", noOp.post.status === 403 && !noOp.codigo, noOp.post.status);
    const anotado = await prisma.auditLog.count({ where: { userId: dueno.id, action: "MCP_RECHAZADO" } });
    revisar("…y queda en la bitácora", anotado === 1, anotado);

    const ajeno = await pedirCodigo(sesion, "permitir", "https://malo.com");
    revisar("un formulario enviado desde otro sitio se rechaza", ajeno.post.status === 403 && !ajeno.codigo, ajeno.post.status);
    const rech = await pedirCodigo(sesion, "rechazar");
    revisar("«Rechazar» regresa access_denied", rech.destino.includes("error=access_denied") && rech.destino.includes("state=estado-123"), rech.destino);

    const a = await pedirCodigo(sesion);
    revisar("el operador ve el botón de permitir", a.pagina.status === 200 && a.pagina.texto.includes("Permitir"));
    revisar("«Permitir» regresa el código a claude.ai con su state", !!a.codigo && a.destino.includes("state=estado-123"), a.destino);

    console.log("\nCanje del código\n");
    const canje = (codigo: string, verificador: string) => http("POST", "/api/oauth/token", { cab: FORM, cuerpo: form({ grant_type: "authorization_code", code: codigo, code_verifier: verificador, client_id: clientId, redirect_uri: REGRESO, resource: `${base}/api/mcp` }) });
    const malPkce = await canje(a.codigo!, pkce().verificador);
    revisar("PKCE equivocado: invalid_grant", malPkce.status === 400 && malPkce.json.error === "invalid_grant", malPkce.json);
    const tarde = await canje(a.codigo!, a.verificador);
    revisar("…y el código ya no sirve después del intento", tarde.status === 400, tarde.json);
    const b = await pedirCodigo(sesion);
    const tok = await canje(b.codigo!, b.verificador);
    revisar("el código bueno da token de acceso y de renovación", tok.status === 200 && !!tok.json.access_token && !!tok.json.refresh_token, tok.json);
    const otraVez = await canje(b.codigo!, b.verificador);
    revisar("un código sirve una sola vez", otraVez.status === 400, otraVez.json);

    let acceso = tok.json.access_token as string;
    let renovacion = tok.json.refresh_token as string;
    const mcp = (cuerpo: unknown, token = acceso) => http("POST", "/api/mcp", { cab: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18" }, cuerpo: JSON.stringify(cuerpo) });
    const llamar = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await mcp({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } });
      const res = r.json.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined;
      let datos: Record<string, unknown> = {};
      try { datos = JSON.parse(res?.content?.[0]?.text ?? "{}"); } catch { /* texto de error */ }
      return { r, res, datos, texto: res?.content?.[0]?.text ?? "" };
    };

    console.log("\nEl protocolo\n");
    const ini = await mcp(JSON.parse(init));
    revisar("initialize responde con herramientas", ini.status === 200 && !!(ini.json.result as { capabilities?: { tools?: unknown } })?.capabilities?.tools, ini.json);
    const notif = await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    revisar("la notificación de inicio: 202 sin cuerpo", notif.status === 202, notif.status);
    const lista = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (lista.json.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }> }).tools;
    revisar("tools/list trae las cinco", tools.map((t) => t.name).sort().join(",") === "buscar_documentacion,consumo_ia,detalle_cliente,listar_clientes,resumen_plataforma", tools.map((t) => t.name));
    revisar("…todas marcadas de solo lectura", tools.every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    revisar("la respuesta conserva las cabeceras de seguridad", !!lista.cab.get("strict-transport-security") && lista.cab.get("x-content-type-options") === "nosniff" && lista.cab.get("x-frame-options") === "DENY", Object.fromEntries(lista.cab));
    const lote = await mcp([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", id: "b", method: "ping" }]);
    revisar("un lote de mensajes", Array.isArray(lote.json) && (lote.json as unknown as unknown[]).length === 2, lote.json);

    console.log("\nLas herramientas\n");
    const resumen = await llamar("resumen_plataforma");
    ejemplos.resumen_plataforma = resumen.datos;
    revisar("resumen_plataforma", !resumen.res?.isError && typeof (resumen.datos.organizaciones as { activas?: number })?.activas === "number", resumen.texto);
    const clientes = await llamar("listar_clientes", { limite: 200 });
    ejemplos.listar_clientes = { ...clientes.datos, clientes: (clientes.datos.clientes as unknown[] | undefined)?.slice(0, 3) };
    const fila = (clientes.datos.clientes as Array<Record<string, unknown>> | undefined)?.find((c) => c.organizacion_id === cliente.id);
    revisar("listar_clientes incluye al cliente de la prueba", !!fila, clientes.texto.slice(0, 300));
    revisar("…con IA en uso, estado de prueba y nivel EN_ARRANQUE", !!fila && (fila.modulosEnUso as string[]).includes("Funciones de IA") && fila.estado === "TRIAL" && fila.nivelAdopcion === "EN_ARRANQUE", fila);
    revisar("…y sin correos ni nombres de personas", !clientes.texto.includes(dueno.email) && !clientes.texto.includes("Dueño"));
    revisar("la cuenta interna no sale en la lista de clientes", !(clientes.datos.clientes as Array<Record<string, unknown>>).some((c) => c.organizacion_id === interna.id));
    const conInternas = await llamar("listar_clientes", { limite: 20, incluir_demo: true, orden: "alta" });
    const filaInterna = (conInternas.datos.clientes as Array<Record<string, unknown>>).find((c) => c.organizacion_id === interna.id);
    revisar("…pero sí si se pide, marcada como interna", filaInterna?.esCuentaInterna === true, filaInterna);
    revisar("el resumen cuenta las internas excluidas", ((resumen.datos.organizaciones as { cuentasInternasExcluidas?: number })?.cuentasInternasExcluidas ?? 0) >= 1, resumen.datos.organizaciones);
    const detalle = await llamar("detalle_cliente", { organizacion_id: cliente.id });
    ejemplos.detalle_cliente = detalle.datos;
    revisar("detalle_cliente", !detalle.res?.isError && (detalle.datos.tendencia as { semanas?: unknown[] })?.semanas?.length === 12, detalle.texto.slice(0, 300));
    revisar("…sin personas del cliente", !detalle.texto.includes(dueno.email));
    const hoy = new Date().toISOString().slice(0, 10);
    const consumo = await llamar("consumo_ia", { desde: "2026-01-01", hasta: hoy, organizacion_id: cliente.id });
    ejemplos.consumo_ia = consumo.datos;
    const org = (consumo.datos.organizaciones as Array<{ tokens: number; porFuncion: Array<{ funcion: string; caracteresDeVoz?: number; segundosDeAudio?: number }> }> | undefined)?.[0];
    revisar("consumo_ia suma solo tokens como tokens", org?.tokens === 1200, org);
    revisar("…y la voz y el dictado en su unidad", org?.porFuncion.find((f) => f.funcion === "VOZ")?.caracteresDeVoz === 5000 && org?.porFuncion.find((f) => f.funcion === "DICTADO")?.segundosDeAudio === 45, org?.porFuncion);
    const doc = await llamar("buscar_documentacion", { pregunta: "¿Cómo registro una lectura de un medidor?" });
    ejemplos.buscar_documentacion = { ...doc.datos, resultados: (doc.datos.resultados as unknown[] | undefined)?.slice(0, 1) };
    revisar("buscar_documentacion", !doc.res?.isError && ((doc.datos.resultados as unknown[]) ?? []).length > 0, doc.texto.slice(0, 300));

    console.log("\nParámetros acotados\n");
    const casos: Array<[string, string, Record<string, unknown>]> = [
      ["límite fuera de rango", "listar_clientes", { limite: 5000 }],
      ["argumento que no existe", "listar_clientes", { borrar: true }],
      ["fecha inválida", "consumo_ia", { desde: "2026-02-30", hasta: "2026-03-01" }],
      ["rango de más de un año", "consumo_ia", { desde: "2024-01-01", hasta: "2026-01-01" }],
      ["hasta antes que desde", "consumo_ia", { desde: "2026-05-01", hasta: "2026-04-01" }],
      ["id con inyección", "detalle_cliente", { organizacion_id: "x' OR 1=1 --" }],
      ["empresa que no existe", "detalle_cliente", { organizacion_id: "cnoexiste00000000000000" }],
      ["pregunta vacía", "buscar_documentacion", { pregunta: "" }],
    ];
    for (const [que, name, args] of casos) {
      const r = await llamar(name, args);
      revisar(`${que}: se rechaza con explicación`, r.res?.isError === true && r.texto.length > 5, r.texto || r.r.json);
    }

    console.log("\nIntentos de escritura\n");
    const inventada = await mcp({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "borrar_organizacion", arguments: { organizacion_id: cliente.id } } });
    revisar("una herramienta de escritura inventada no existe", !!inventada.json.error && (inventada.json.error as { code: number }).code === -32602, inventada.json);
    for (const metodo of ["PUT", "PATCH", "DELETE", "GET"]) {
      const r = await http(metodo, "/api/mcp", { cab: { Authorization: `Bearer ${acceso}` } });
      revisar(`${metodo} /api/mcp: 405`, r.status === 405, r.status);
    }
    const otroMetodo = await mcp({ jsonrpc: "2.0", id: 10, method: "resources/write", params: {} });
    revisar("un método que no existe: -32601", (otroMetodo.json.error as { code?: number })?.code === -32601, otroMetodo.json);
    const despues = await fotoDeLasDemas(nuestras);
    revisar("ningún dato de otra empresa cambió", antes === despues, { antes, despues });
    const sigueIgual = await prisma.organization.findUnique({ where: { id: cliente.id } });
    revisar("el cliente sigue ahí, sin tocar", sigueIgual?.name === cliente.name && sigueIgual.updatedAt.getTime() === cliente.updatedAt.getTime());

    console.log("\nBitácora\n");
    const bitacora = await prisma.auditLog.findMany({ where: { userId: operador.id, action: "MCP_ACCESS" }, orderBy: { createdAt: "asc" } });
    const llamadasHechas = 6 + casos.length + 1;
    revisar(`cada llamada a herramienta dejó su renglón (${llamadasHechas})`, bitacora.length === llamadasHechas, bitacora.length);
    const uno = bitacora.find((x) => x.entityId === "consumo_ia");
    const cambios = JSON.parse(uno?.changes ?? "{}");
    revisar("…con herramienta, parámetros y usuario", cambios.herramienta === "consumo_ia" && cambios.parametros?.desde === "2026-01-01" && cambios.usuario === operador.email && uno?.organizationId === propia.id, cambios);
    revisar("…el intento de escritura también", bitacora.some((x) => x.entityId === "borrar_organizacion" && (x.summary ?? "").includes("inexistente")));
    revisar("…y la autorización", (await prisma.auditLog.count({ where: { userId: operador.id, action: "MCP_AUTORIZADO" } })) === 2);

    console.log("\nRenovación y revocación\n");
    const renovar = (rt: string) => http("POST", "/api/oauth/token", { cab: FORM, cuerpo: form({ grant_type: "refresh_token", refresh_token: rt, client_id: clientId }) });
    const ren = await renovar(renovacion);
    revisar("renovar da un par nuevo", ren.status === 200 && ren.json.access_token !== acceso, ren.json);
    const viejaRenovacion = renovacion;
    acceso = ren.json.access_token as string;
    renovacion = ren.json.refresh_token as string;
    revisar("el acceso nuevo funciona", (await mcp({ jsonrpc: "2.0", id: 1, method: "ping" })).status === 200);
    const reuso = await renovar(viejaRenovacion);
    revisar("reusar una renovación ya canjeada se rechaza", reuso.status === 400, reuso.json);
    revisar("…y corta toda la familia", (await mcp({ jsonrpc: "2.0", id: 1, method: "ping" })).status === 401);

    // Un token nuevo, y se le quita el privilegio al operador.
    const c = await pedirCodigo(await entrar(base, operador.email, CLAVE));
    const t2 = await canje(c.codigo!, c.verificador);
    acceso = t2.json.access_token as string;
    await prisma.user.update({ where: { id: operador.id }, data: { isSuperAdmin: false } });
    const degradado = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "resumen_plataforma", arguments: {} } });
    revisar("token de quien dejó de ser operador: 403", degradado.status === 403, degradado.status);
    revisar("…y se anota el rechazo", (await prisma.auditLog.count({ where: { userId: operador.id, action: "MCP_RECHAZADO" } })) === 1);
    const renDegradado = await renovar(t2.json.refresh_token as string);
    revisar("…y tampoco puede renovar", renDegradado.status === 400, renDegradado.json);
    await prisma.user.update({ where: { id: operador.id }, data: { isSuperAdmin: true } });

    const d = await pedirCodigo(await entrar(base, operador.email, CLAVE));
    const t3 = await canje(d.codigo!, d.verificador);
    await new Promise((r) => setTimeout(r, 1100));
    await prisma.user.update({ where: { id: operador.id }, data: { sessionsValidFrom: new Date() } });
    const cerrado = await mcp({ jsonrpc: "2.0", id: 1, method: "ping" }, t3.json.access_token as string);
    revisar("«cerrar sesión en todos los dispositivos» desconecta al agente (401)", cerrado.status === 401, cerrado.status);
  } finally {
    await apagarServidor(servidor, PUERTO);
    if (fallas && !process.env.BASE_URL) console.log(`\n── Log del servidor ──\n${colaDelLog(PUERTO)}`);
    await prisma.clienteOAuth.deleteMany({ where: { clientId: { in: clientesCreados } } });
    for (const id of nuestras) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    const archivo = join(tmpdir(), "maintrack-mcp-ejemplos.json");
    writeFileSync(archivo, JSON.stringify(ejemplos, null, 2));
    console.log(`\nEjemplos de respuesta: ${archivo}`);
  }

  console.log(fallas ? `\n${fallas} falla(s).\n` : "\nTodo en orden.\n");
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
