/**
 * El tecnico cierra la orden hablando.
 *
 * ── Que se cuida aqui ──
 *
 * Lo que esta prueba vigila NO es que la transcripcion entienda —eso depende
 * de Google y se prueba de verdad en `prueba-dictado-real.ts`, con audio y
 * con costo—. Aqui se cuida lo que puede romperse solo, sin que nadie se
 * entere:
 *
 *   1. Que el candado exista EN LA RUTA. La bolsa de dictados se gasta con
 *      una peticion, no con el boton: sin candado, una cuenta de solo lectura
 *      puede vaciarsela a su empresa desde la consola del navegador.
 *   2. Que el tecnico SI pueda. Es a quien sirve esto, y ya paso una vez que
 *      una funcion del piso quedara detras de un permiso de administracion.
 *   3. Que la bolsa sea de verdad propia: que dictar no le quite operaciones
 *      al jefe, ni que la del jefe deje sin microfono al tecnico.
 *   4. Que lo que NO se cobro no se registre. Un fallo de transcripcion no
 *      puede aparecer como gasto: ese numero termina en el tablero de costos.
 *
 *   npx tsx scripts/prueba-dictado.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { unirDictado, MAXIMO_SEGUNDOS_DICTADO } from "../lib/dictado";
import { iaDeLaOrganizacion } from "../lib/planes";
import { puedeUsarIa } from "../lib/ia/consumo";
import { apagarServidor } from "./apagar-servidor";

const PUERTO = 3217;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function esperarServidor(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) return;
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

const periodo = () => new Date().toISOString().slice(0, 7);

async function main() {
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", String(PUERTO), "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `dic-${Date.now()}`;
  const creadas: string[] = [];

  try {
    console.log("\nUnir lo dictado con lo que ya había\n");
    revisar("sobre un campo vacío queda tal cual",
      unirDictado("", "Cambié el rodamiento.") === "Cambié el rodamiento.");
    revisar("nunca pisa lo anterior: lo agrega",
      unirDictado("Venía haciendo ruido.", "Cambié el rodamiento.")
        === "Venía haciendo ruido. Cambié el rodamiento.");
    revisar("y le pone punto cuando lo anterior no cerraba",
      unirDictado("Venía haciendo ruido", "Cambié el rodamiento.")
        === "Venía haciendo ruido. Cambié el rodamiento.");
    // Un dictado vacio no puede borrar lo que el tecnico ya habia escrito a
    // mano: perder texto es peor que no dictar.
    revisar("un dictado vacío no borra nada",
      unirDictado("Lo que ya escribí", "   ") === "Lo que ya escribí");

    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(org.id);
    const conIa = { id: org.id, plan: "PROFESSIONAL", iaComplemento: false, iaExtra: 0 };

    const tecnico = await prisma.user.create({
      data: { organizationId: org.id, email: `t-${sello}@t.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: "x" },
    });
    const mirona = await prisma.user.create({
      data: { organizationId: org.id, email: `v-${sello}@t.mx`, name: "Consulta", role: "VIEWER", passwordHash: "x" },
    });

    await esperarServidor();
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const credencial = (u: { id: string; email: string; name: string; role: string }) =>
      new SignJWT({ userId: u.id, organizationId: org.id, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);

    const jwtTecnico = await credencial(tecnico);
    const jwtMirona = await credencial(mirona);

    const dictar = async (jwt: string, cuerpo: BodyInit) => {
      const r = await fetch(`${base}/api/ia/voz/dictar`, {
        method: "POST", headers: { Cookie: `mt_session=${jwt}` }, body: cuerpo,
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };

    // Bytes cualquiera: no es audio de verdad y no se pretende que lo sea.
    // Lo que se ejercita con esto es el control ANTES de transcribir.
    const algoDeAudio = new Uint8Array(2048);

    console.log("\nQuién puede dictar\n");
    const deMirona = await dictar(jwtMirona, algoDeAudio);
    revisar("una cuenta de solo lectura no puede gastar la bolsa de su empresa",
      deMirona.status === 403, { status: deMirona.status });

    // El tecnico llega hasta transcribir. Sin credencial de Google en esta
    // maquina eso termina en 502, y ESE es justamente el caso interesante de
    // aqui abajo: un fallo que no debe registrarse como gasto.
    const delTecnico = await dictar(jwtTecnico, algoDeAudio);
    revisar("el técnico sí pasa el candado: no se queda fuera quien lo necesita",
      delTecnico.status !== 403 && delTecnico.status !== 402, { status: delTecnico.status });

    console.log("\nLo que ni siquiera se intenta transcribir\n");
    const vacio = await dictar(jwtTecnico, new Uint8Array(0));
    revisar("sin audio se rechaza antes de llamar a nadie", vacio.status === 422, { status: vacio.status });

    const enorme = await dictar(jwtTecnico, new Uint8Array(5 * 1024 * 1024));
    revisar("una grabación descomunal se rechaza", enorme.status === 413, { status: enorme.status });
    revisar("y el mensaje dice el límite en segundos, no en megas",
      String(enorme.json.error ?? "").includes(`${MAXIMO_SEGUNDOS_DICTADO} segundos`),
      String(enorme.json.error).slice(0, 80));

    console.log("\nLo que falló no se cobra\n");
    // Si la transcripcion no se pudo hacer, no hubo nada que facturar. Un
    // registro aqui seria un gasto inventado en el tablero de costos.
    if (delTecnico.status === 502) {
      const gastos = await prisma.aiUsage.count({ where: { organizationId: org.id, funcion: "DICTADO" } });
      revisar("una transcripción que no se pudo hacer no deja gasto registrado",
        gastos === 0, { registros: gastos });
    } else {
      console.log("  --   (se saltó: hay credencial de Google, esto se prueba en prueba-dictado-real)");
    }

    console.log("\nLa bolsa es suya, y tiene fondo\n");
    const cupo = iaDeLaOrganizacion(conIa).bolsas.DICTADO;
    revisar("el plan de entrada trae cupo de dictado", cupo > 0, { cupo });

    const gastar = (funcion: string, veces: number, ok = true) =>
      prisma.aiUsage.createMany({
        data: Array.from({ length: veces }, () => ({
          organizationId: org.id, funcion, periodo: periodo(), ok, modelo: "prueba",
          operaciones: ok ? 1 : 0,
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costoUsd: 0.0002,
        })),
      });

    // Lo que no se entendio quedo con ok:false: cuesta, pero no descuenta.
    await gastar("DICTADO", 50, false);
    const traseFallidos = await puedeUsarIa(conIa, "DICTADO");
    revisar("cincuenta audios que no se entendieron no le gastan un solo dictado",
      traseFallidos.permitido && traseFallidos.restantes === cupo,
      traseFallidos.permitido ? `quedan ${traseFallidos.restantes}` : traseFallidos.motivo);

    await gastar("DICTADO", cupo);
    const agotado = await puedeUsarIa(conIa, "DICTADO");
    revisar("al pasarse del cupo, el dictado se detiene", !agotado.permitido,
      agotado.permitido ? "" : agotado.motivoCorto);
    revisar("y lo dice sin dejar al técnico sin poder cerrar su orden",
      !agotado.permitido && agotado.motivo.includes("a mano"),
      agotado.permitido ? "" : agotado.motivo);

    const conBolsaAgotada = await dictar(jwtTecnico, algoDeAudio);
    revisar("y la ruta lo respeta: 402, no un 403 que sonaría a falta de permiso",
      conBolsaAgotada.status === 402, { status: conBolsaAgotada.status });

    console.log("\nLo que NO debe pasar\n");
    // El punto de la bolsa propia: el tecnico dicta aunque el plan este seco.
    const { consumoIa } = await import("../lib/ia/consumo");
    const consumo = await consumoIa(org.id);
    revisar("nada de lo dictado le descontó operaciones del plan",
      consumo.operacionesDelPlan === 0, { delPlan: consumo.operacionesDelPlan, total: consumo.operaciones });

    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otra.id);
    const vecina = await puedeUsarIa({ id: otra.id, plan: "PROFESSIONAL", iaComplemento: false, iaExtra: 0 }, "DICTADO");
    revisar("lo que gastó una empresa no deja muda a la de al lado", vecina.permitido);
  } finally {
    for (const id of creadas) {
      await prisma.aiUsage.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await apagarServidor(servidor, PUERTO);
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
