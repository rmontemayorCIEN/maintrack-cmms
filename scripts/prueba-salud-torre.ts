/**
 * El reporte de salud para la Torre de Control (`/api/salud/detalle`).
 *
 * Llama a `responderSalud`, la MISMA funcion que contesta la ruta, con una
 * peticion armada aqui: no reproduce los pasos de la ruta. La fecha va fija
 * (las revisiones reciben `ahora`), asi que la prueba no depende del mes real.
 *
 * Lo que cuida:
 *  - Sin token configurado, con uno corto o con uno equivocado: 404.
 *  - Con token: un reporte que cumple el contrato (largos, estados, grupos).
 *  - Una revision que truena o se tarda sale «desconocido» y no tumba el resto,
 *    y el mensaje del error NO sale en la respuesta.
 *  - Las cifras cuentan lo que hay: se siembran casos y se mide la diferencia.
 *  - Ningun correo, telefono, identificador ni valor de secreto en la salida.
 *
 *   npx tsx scripts/prueba-salud-torre.ts
 */
import { prisma } from "../lib/db";
import { responderSalud, type DefinicionRevision } from "../lib/salud/maintrack";
import { CONTRATO_VERSION, LIMITES, type ReporteSalud, type Revision } from "../lib/salud/contrato";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien && d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

const AHORA = new Date("2026-03-15T18:00:00.000Z");
const HORA = 3_600_000;
const TOKEN = "t".repeat(20) + "0123456789abcdefghijklmnopqrstuv"; // 52 caracteres
const ESTADOS = ["ok", "atencion", "falla", "desconocido"];
const GRUPOS = ["infraestructura", "procesos", "mensajeria", "llamadas", "notificaciones", "ia", "integraciones", "seguridad"];
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const TELEFONO = /\+?\d[\d\s().-]{8,}\d/;
const CUID = /\bc[a-z0-9]{24}\b/;

const peticion = (autorizacion?: string) =>
  new Request("http://localhost/api/salud/detalle", { headers: autorizacion ? { authorization: autorizacion } : {} });

async function reporte(opciones: { lista?: DefinicionRevision[] } = {}) {
  const r = await responderSalud(peticion(`Bearer ${TOKEN}`), { ahora: AHORA, ...opciones });
  const texto = await r.text();
  return { status: r.status, cache: r.headers.get("cache-control"), texto, json: JSON.parse(texto) as ReporteSalud };
}
const de = (rep: ReporteSalud, clave: string) => rep.revisiones.find((x) => x.clave === clave);

/** Una revision cumple el contrato: lo mismo que la Torre valida con zod. */
function problemasDe(r: Revision): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.clave) || r.clave.length > LIMITES.clave) p.push("clave");
  if (!r.nombre || r.nombre.length > LIMITES.nombre) p.push("nombre");
  if (!GRUPOS.includes(r.grupo)) p.push("grupo");
  if (!ESTADOS.includes(r.estado)) p.push("estado");
  if (!r.detalle || r.detalle.length > LIMITES.detalle) p.push("detalle");
  if (r.unidad != null && r.unidad.length > LIMITES.unidad) p.push("unidad");
  if (r.valor != null && !Number.isFinite(r.valor)) p.push("valor");
  if (r.arreglarEn != null && (!r.arreglarEn.startsWith("/") || r.arreglarEn.length > LIMITES.ruta)) p.push("arreglarEn");
  for (const f of ["desde", "vence"] as const) if (r[f] != null && Number.isNaN(Date.parse(r[f]!))) p.push(f);
  return p;
}

async function main() {
  const original = { ...process.env };
  const sello = `salud-${Date.now()}`;
  let orgId: string | null = null;
  const procesosPrevios: Array<{ clave: string; fila: Awaited<ReturnType<typeof prisma.procesoProgramado.findUnique>> }> = [];

  try {
    // ── 1. La puerta ────────────────────────────────────────────────────
    console.log("\n1. Sin el token correcto la ruta no existe");
    delete process.env.TORRE_SALUD_TOKEN;
    let r = await responderSalud(peticion(`Bearer ${TOKEN}`), { ahora: AHORA });
    revisar("sin TORRE_SALUD_TOKEN configurado: 404", r.status === 404, r.status);
    revisar("y sin cuerpo", (await r.text()) === "");

    process.env.TORRE_SALUD_TOKEN = "corto-de-mas";
    r = await responderSalud(peticion("Bearer corto-de-mas"), { ahora: AHORA });
    revisar("con un token configurado de menos de 32: 404 aunque coincida", r.status === 404, r.status);

    process.env.TORRE_SALUD_TOKEN = TOKEN;
    r = await responderSalud(peticion(), { ahora: AHORA });
    revisar("sin encabezado: 404", r.status === 404, r.status);
    r = await responderSalud(peticion(`Bearer ${TOKEN.slice(0, -1)}x`), { ahora: AHORA });
    revisar("token equivocado del mismo largo: 404", r.status === 404, r.status);
    r = await responderSalud(peticion(`Bearer ${TOKEN}extra`), { ahora: AHORA });
    revisar("token con algo de mas: 404", r.status === 404, r.status);

    // ── 2. El reporte cumple el contrato ────────────────────────────────
    console.log("\n2. Con token, un reporte que la Torre acepta");
    process.env.CRON_SECRET = "valor-secreto-que-no-debe-salir-9f3k";
    delete process.env.IA_PRESUPUESTO_MENSUAL_USD;
    const antes = await reporte();
    revisar("contesta 200", antes.status === 200, antes.status);
    revisar("Cache-Control: no-store", antes.cache === "no-store", antes.cache);
    revisar("contrato, app y fecha", antes.json.contrato === CONTRATO_VERSION && antes.json.app === "maintrack" && antes.json.generadoEn === AHORA.toISOString(), antes.json);
    revisar("cabe en lo que la Torre lee", Buffer.byteLength(antes.texto) <= LIMITES.bytes, Buffer.byteLength(antes.texto));
    revisar(`a lo mas ${LIMITES.revisiones} revisiones`, antes.json.revisiones.length <= LIMITES.revisiones);
    const malas = antes.json.revisiones.map((x) => ({ clave: x.clave, p: problemasDe(x) })).filter((x) => x.p.length);
    revisar("cada revision cumple el contrato", malas.length === 0, malas);
    const claves = antes.json.revisiones.map((x) => x.clave);
    revisar("claves sin repetir", new Set(claves).size === claves.length, claves);
    const esperadas = ["base-de-datos", "proceso-avisos", "proceso-scheduler", "proceso-disponibles", "proceso-diagnostico",
      "push-envios", "push-suscripciones", "avisos-atorados", "webhooks-suspendidos", "ia-errores", "ia-presupuesto", "secretos-requeridos"];
    revisar("estan todas las revisiones", esperadas.every((c) => claves.includes(c)), esperadas.filter((c) => !claves.includes(c)));
    revisar("la base contesto", de(antes.json, "base-de-datos")?.estado !== "desconocido", de(antes.json, "base-de-datos"));
    revisar("sin presupuesto de IA: «desconocido», no verde", de(antes.json, "ia-presupuesto")?.estado === "desconocido", de(antes.json, "ia-presupuesto"));

    // ── 3. Las cifras cuentan lo que hay ────────────────────────────────
    console.log("\n3. Las cifras cuentan lo sembrado (diferencia antes/despues)");
    // Llaves de mentira: el reporte solo pregunta si estan, no envia nada. Asi
    // la prueba no depende del .env de quien la corre (en CI no hay VAPID).
    process.env.VAPID_PUBLIC_KEY = "llave-publica-de-prueba";
    process.env.VAPID_PRIVATE_KEY = "llave-privada-de-prueba";
    const org = await prisma.organization.create({
      data: { name: `Empresa ${sello}`, slug: sello, plan: "ENTERPRISE", status: "ACTIVE" },
    });
    orgId = org.id;
    const persona = await prisma.user.create({
      data: { organizationId: org.id, email: `persona-${sello}@ejemplo.mx`, name: "Persona Sintetica", role: "OWNER", passwordHash: "x" },
    });
    const hace1h = new Date(AHORA.getTime() - HORA);
    const entrega = (n: string, datos: Record<string, unknown>) =>
      prisma.entregaAviso.create({
        data: {
          organizationId: org.id, userId: persona.id, tipo: "GENERAL", eventoId: `evt-${sello}-${n}`,
          canal: "NAVEGADOR", claveDedup: `${sello}-${n}`, resumen: `Aviso para persona-${sello}@ejemplo.mx`,
          createdAt: hace1h, updatedAt: hace1h, ...datos,
        },
      });
    for (let i = 0; i < 6; i++) await entrega(`f${i}`, { estado: "FALLIDA", errorCategoria: "TEMPORAL", errorDetalle: "tel 81 1234 5678" });
    await entrega("ajena", { estado: "FALLIDA", errorCategoria: "SIN_DISPOSITIVOS" });
    await entrega("ok", { estado: "ENTREGADA" });
    await entrega("atorada", { estado: "PENDIENTE", programadaPara: new Date(AHORA.getTime() - 2 * HORA) });
    await entrega("reciente", { estado: "PENDIENTE", programadaPara: new Date(AHORA.getTime() - 5 * 60_000) });
    await entrega("futura", { estado: "PENDIENTE", programadaPara: new Date(AHORA.getTime() + HORA) });
    await entrega("viejo", { estado: "FALLIDA", errorCategoria: "TEMPORAL", updatedAt: new Date(AHORA.getTime() - 30 * HORA) });
    const uso = (ok: boolean, costoUsd: number) =>
      prisma.aiUsage.create({
        data: { organizationId: org.id, userId: persona.id, funcion: "DIAGNOSTICO", modelo: "prueba", periodo: "2026-03", ok, costoUsd, createdAt: hace1h, error: ok ? null : `fallo con persona-${sello}@ejemplo.mx` },
      });
    await uso(false, 1.25);
    await uso(true, 0.5);

    const despues = await reporte();
    const delta = (clave: string) => (de(despues.json, clave)?.valor ?? 0) - (de(antes.json, clave)?.valor ?? 0);
    revisar("push: cuenta las 6 fallas propias, ni la ajena ni la de hace 30 h", delta("push-envios") === 6, delta("push-envios"));
    revisar("cola: solo la atorada hace 2 h (no la de hace 5 min ni la futura)", delta("avisos-atorados") === 1, delta("avisos-atorados"));
    revisar("IA: una llamada fallida mas", delta("ia-errores") === 1, delta("ia-errores"));
    revisar("IA: el gasto del mes sube 1.75 USD", Math.abs(delta("ia-presupuesto") - 1.75) < 0.011, delta("ia-presupuesto"));

    // ── 4. Nada de datos personales ni secretos ─────────────────────────
    console.log("\n4. Nada que identifique a nadie");
    const sinPersonales = (crudo: string) => {
      // Las fechas ISO parecen telefono para la expresion; se quitan antes.
      const texto = crudo.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<fecha>");
      const p: string[] = [];
      if (CORREO.test(texto)) p.push(`correo: ${texto.match(CORREO)?.[0]}`);
      if (TELEFONO.test(texto)) p.push(`telefono: ${texto.match(TELEFONO)?.[0]}`);
      if (CUID.test(texto)) p.push(`identificador: ${texto.match(CUID)?.[0]}`);
      for (const prohibido of [org.id, persona.id, org.name, sello]) if (texto.includes(prohibido)) p.push(`dato sembrado: ${prohibido}`);
      return p;
    };
    revisar("ningun correo, telefono, identificador ni dato sembrado", sinPersonales(despues.texto).length === 0, sinPersonales(despues.texto));
    revisar("el valor de un secreto no sale", !despues.texto.includes(process.env.CRON_SECRET!));

    // ── 5. Secretos y presupuesto ───────────────────────────────────────
    console.log("\n5. Secretos que faltan y presupuesto de IA");
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CRON_SECRET;
    process.env.IA_PRESUPUESTO_MENSUAL_USD = "1000000";
    const sinSecretos = await reporte();
    const sec = de(sinSecretos.json, "secretos-requeridos");
    revisar("sin CRON_SECRET: falla, y dice cual falta", sec?.estado === "falla" && sec.detalle.includes("CRON_SECRET") && sec.detalle.includes("ANTHROPIC_API_KEY"), sec);
    revisar("con presupuesto holgado: ok", de(sinSecretos.json, "ia-presupuesto")?.estado === "ok", de(sinSecretos.json, "ia-presupuesto"));
    process.env.IA_PRESUPUESTO_MENSUAL_USD = "0.01";
    const pasado = await reporte();
    revisar("gasto por encima del presupuesto: falla", de(pasado.json, "ia-presupuesto")?.estado === "falla", de(pasado.json, "ia-presupuesto"));
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const sinPush = de((await reporte()).json, "push-envios");
    revisar("sin llaves VAPID: falla y lo dice", sinPush?.estado === "falla" && sinPush.detalle.startsWith("Sin llaves"), sinPush);

    // ── 6. Una revision que truena no tumba el reporte ──────────────────
    console.log("\n6. Una revision que truena o se tarda");
    const lista: DefinicionRevision[] = [
      { base: { clave: "truena", nombre: "Truena", grupo: "infraestructura" }, fn: async () => { throw new Error("postgres://u:clave@host persona@ejemplo.mx"); } },
      { base: { clave: "se-tarda", nombre: "Se tarda", grupo: "infraestructura" }, milisegundos: 50, fn: () => new Promise((ok) => setTimeout(() => ok({ estado: "ok", detalle: "tarde" }), 2000)) },
      { base: { clave: "sana", nombre: "Sana", grupo: "infraestructura" }, fn: async () => ({ estado: "ok", detalle: "bien" }) },
    ];
    const conFalla = await reporte({ lista });
    revisar("el reporte sale con 200", conFalla.status === 200, conFalla.status);
    revisar("la que truena: desconocido", de(conFalla.json, "truena")?.estado === "desconocido", de(conFalla.json, "truena"));
    revisar("la que se tarda: desconocido", de(conFalla.json, "se-tarda")?.estado === "desconocido", de(conFalla.json, "se-tarda"));
    revisar("la sana sigue ok", de(conFalla.json, "sana")?.estado === "ok", de(conFalla.json, "sana"));
    revisar("el mensaje del error no sale", !conFalla.texto.includes("postgres") && !CORREO.test(conFalla.texto), conFalla.texto);

    // ── 7. Los procesos se miden contra `ahora`, no contra el reloj ─────
    //
    // Se usan las filas de los procesos vigilados en la base LOCAL de la
    // prueba: se guarda como estaban y se dejan igual al terminar.
    console.log("\n7. Los procesos usan la fecha que se les da");
    for (const clave of ["cron:diagnostico", "cron:avisos", "cron:disponibles"]) {
      const fila = await prisma.procesoProgramado.findUnique({ where: { clave } });
      procesosPrevios.push({ clave, fila });
    }
    const fijar = (clave: string, datos: { ultimoFin: Date | null; fallasSeguidas: number }) =>
      prisma.procesoProgramado.upsert({ where: { clave }, update: { ...datos, corriendoDesde: null }, create: { clave, ...datos } });
    await fijar("cron:diagnostico", { ultimoFin: hace1h, fallasSeguidas: 0 });
    await fijar("cron:avisos", { ultimoFin: new Date(AHORA.getTime() - 2 * 60_000), fallasSeguidas: 2 });
    await fijar("cron:disponibles", { ultimoFin: null, fallasSeguidas: 0 });

    const hoy = (await reporte()).json;
    revisar("semanal que corrio hace 1 h: ok", de(hoy, "proceso-diagnostico")?.estado === "ok", de(hoy, "proceso-diagnostico"));
    revisar("con 2 fallas seguidas: atencion", de(hoy, "proceso-avisos")?.estado === "atencion", de(hoy, "proceso-avisos"));
    revisar("el que nunca ha corrido: desconocido, no rojo", de(hoy, "proceso-disponibles")?.estado === "desconocido", de(hoy, "proceso-disponibles"));
    revisar("minutos medidos contra `ahora`", de(hoy, "proceso-diagnostico")?.valor === 60, de(hoy, "proceso-diagnostico")?.valor);

    await fijar("cron:avisos", { ultimoFin: new Date(AHORA.getTime() - 2 * 60_000), fallasSeguidas: 3 });
    const lejos = await responderSalud(peticion(`Bearer ${TOKEN}`), { ahora: new Date("2099-01-01T00:00:00Z") });
    const rep = (await lejos.json()) as ReporteSalud;
    revisar("en 2099, el semanal sale callado (falla) y dice desde cuando", de(rep, "proceso-diagnostico")?.estado === "falla" && de(rep, "proceso-diagnostico")?.desde === hace1h.toISOString(), de(rep, "proceso-diagnostico"));
    revisar("tres fallas seguidas: falla", de(rep, "proceso-avisos")?.estado === "falla", de(rep, "proceso-avisos"));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
    Object.assign(process.env, original);
    for (const { clave, fila } of procesosPrevios) {
      if (fila) await prisma.procesoProgramado.update({ where: { clave }, data: fila });
      else await prisma.procesoProgramado.deleteMany({ where: { clave } });
    }
    if (orgId) {
      await prisma.entregaAviso.deleteMany({ where: { organizationId: orgId } });
      await prisma.aiUsage.deleteMany({ where: { organizationId: orgId } });
      await prisma.user.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  }

  console.log(fallas ? `\n${fallas} falla(s)\n` : "\nTodo bien.\n");
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
