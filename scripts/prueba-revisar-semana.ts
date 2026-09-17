/**
 * «Revisar la semana»: el boton nunca se queda trabado y revisa la semana correcta.
 *
 * El estado infinito salia de un `fetch` que lanzaba (se cae la red) o no
 * respondia: la linea que quitaba «Revisando…» nunca corria. `pedirJson` es la
 * funcion que usa el boton; aqui se prueba contra un servidor real que falla
 * de cada forma posible.
 *
 *   npx tsx scripts/prueba-revisar-semana.ts
 */
import { createServer, type Server } from "node:http";
import { pedirJson } from "../lib/pedir";
import { lunesDe, rangoDeSemana, semanaARevisar } from "../lib/semana";
import { prisma } from "../lib/db";
import { revisarSemana } from "../lib/ia/agenda";
import { consumoIa } from "../lib/ia/consumo";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

async function main() {
  console.log("\n1. La petición siempre termina");
  const servidor: Server = createServer((req, res) => {
    if (req.url === "/ok") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ revision: { resumen: "x" } })); }
    else if (req.url === "/error") { res.writeHead(422, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "No hay órdenes abiertas en esa semana." })); }
    else if (req.url === "/html") { res.writeHead(502); res.end("<html>Bad gateway</html>"); }
    else if (req.url === "/cuelga") { /* nunca responde */ }
    else if (req.url === "/corta") { req.socket.destroy(); }
  });
  await new Promise<void>((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;

  try {
    const ok = await pedirJson<{ revision: { resumen: string } }>(`${base}/ok`, { method: "POST" });
    revisar("respuesta correcta: entrega el cuerpo", ok.ok && ok.cuerpo.revision.resumen === "x");

    const err = await pedirJson(`${base}/error`, { method: "POST" });
    revisar("error del servidor: entrega su mensaje, no lanza", !err.ok && err.motivo === "HTTP" && err.error.includes("No hay órdenes"), err);

    const html = await pedirJson(`${base}/html`, { method: "POST" });
    revisar("respuesta que no es JSON (502): mensaje con el código, no lanza", !html.ok && html.status === 502 && html.error.includes("502"), html);

    const t0 = Date.now();
    const cuelga = await pedirJson(`${base}/cuelga`, { method: "POST", limiteMs: 500 });
    revisar("el servidor no responde: se cancela al tiempo límite", !cuelga.ok && cuelga.motivo === "TIEMPO" && Date.now() - t0 < 3000, { ...cuelga, ms: Date.now() - t0 });

    const corta = await pedirJson(`${base}/corta`, { method: "POST" });
    revisar("se corta la conexión: mensaje de red, no lanza", !corta.ok && corta.motivo === "RED", corta);

    const sinServidor = await pedirJson("http://127.0.0.1:1/nada", { method: "POST", limiteMs: 2000 });
    revisar("no hay servidor: termina con error, no lanza", !sinServidor.ok, sinServidor);
  } finally {
    servidor.closeAllConnections?.();
    servidor.close();
  }

  console.log("\n2. Se revisa la semana que se está viendo");
  revisar("lunes de un miércoles", lunesDe("2026-09-17") === "2026-09-14");
  revisar("lunes de un domingo es el de esa semana", lunesDe("2026-09-20") === "2026-09-14");
  revisar("vista de mes con hoy dentro: la semana de hoy (no la del día 1)",
    semanaARevisar({ vista: "mes", desde: "2026-09-01", hasta: "2026-09-30", hoy: "2026-09-17" }) === "2026-09-14");
  revisar("vista de mes de otro mes: la primera semana de ese mes",
    semanaARevisar({ vista: "mes", desde: "2026-10-01", hasta: "2026-10-31", hoy: "2026-09-17" }) === "2026-09-28");
  revisar("vista de semana: esa semana", semanaARevisar({ vista: "semana", desde: "2026-09-21", hasta: "2026-09-27", hoy: "2026-09-17" }) === "2026-09-21");
  revisar("vista de día: la semana de ese día", semanaARevisar({ vista: "dia", desde: "2026-09-24", hasta: "2026-09-24", hoy: "2026-09-17" }) === "2026-09-21");
  revisar("el rango se nombra para la persona", rangoDeSemana("2026-09-17").texto === "del 14 al 20 sept" || /del 14 al 20 sep/.test(rangoDeSemana("2026-09-17").texto), rangoDeSemana("2026-09-17"));
  revisar("semana que cruza de mes nombra los dos meses", /del 28 sep.* al 4 oct/.test(rangoDeSemana("2026-09-30").texto), rangoDeSemana("2026-09-30"));

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n3. Una revisión ya pagada no se vuelve a cobrar");
  const sello = `prueba-revsem-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", iaComplemento: true, timezone: "America/Monterrey" },
    select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
  });
  try {
    const tec = await prisma.user.create({
      data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Tecnico", role: "TECHNICIAN", passwordHash: "x" },
    });
    // Un dia habil de la proxima semana, para que haya dias disponibles.
    const dia = new Date(); dia.setHours(0, 0, 0, 0);
    dia.setDate(dia.getDate() + ((8 - dia.getDay()) % 7 || 7) + 1); // martes proximo
    const orden = await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-S1", title: "Preventivo", status: "ASSIGNED", assignedToId: tec.id, dueDate: dia, estimatedHours: 3 },
    });

    let llamadas = 0;
    // Hace lo que hace la llamada real: contesta y registra el consumo (2 operaciones).
    const analizar = (async () => {
      llamadas++;
      await prisma.aiUsage.create({
        data: { organizationId: org.id, funcion: "AGENDA", modelo: "prueba", operaciones: 2, costoUsd: 0.05, periodo: new Date().toISOString().slice(0, 7), ok: true },
      });
      return {
        datos: { resumen: `Revisión ${llamadas}`, movimientos: [], agrupaciones: [], noMover: [], advertencia: null },
        modelo: "prueba", costoUsd: 0.05,
      };
    }) as unknown as NonNullable<Parameters<typeof revisarSemana>[2]>["analizar"];

    const r1 = await revisarSemana(org, { desde: dia, userId: tec.id }, { analizar });
    const opsTras1 = (await consumoIa(org.id)).operaciones;
    revisar("primera revisión: llama al modelo y cobra 2 operaciones",
      r1.ok && !r1.reutilizada && llamadas === 1 && opsTras1 === 2, { llamadas, opsTras1 });

    // La respuesta «no llegó» a la pantalla: la persona vuelve a intentar.
    const r2 = await revisarSemana(org, { desde: dia, userId: tec.id }, { analizar });
    const opsTras2 = (await consumoIa(org.id)).operaciones;
    revisar("reintento con los mismos datos: entrega la misma revisión sin llamar ni cobrar",
      r2.ok && r2.reutilizada && llamadas === 1 && opsTras2 === 2 && r2.revision.resumen === "Revisión 1",
      { llamadas, opsTras2, reutilizada: r2.ok && r2.reutilizada });
    revisar("queda contado cuántas veces se reutilizó",
      (await prisma.revisionAgenda.findFirstOrThrow({ where: { organizationId: org.id } })).reutilizaciones === 1);

    // Cambia la semana: ya no es la misma pregunta.
    await prisma.workOrder.update({ where: { id: orden.id }, data: { estimatedHours: 6 } });
    const r3 = await revisarSemana(org, { desde: dia, userId: tec.id }, { analizar });
    revisar("si cambian los datos de la semana, sí se genera (y cobra) una nueva",
      r3.ok && !r3.reutilizada && llamadas === 2 && (await consumoIa(org.id)).operaciones === 4);

    // Con el cupo agotado, lo ya pagado se sigue entregando.
    await prisma.aiUsage.create({
      data: { organizationId: org.id, funcion: "AGENDA", modelo: "prueba", operaciones: 1_000_000, costoUsd: 0, periodo: new Date().toISOString().slice(0, 7), ok: true },
    });
    const r4 = await revisarSemana(org, { desde: dia, userId: tec.id }, { analizar });
    revisar("con el cupo agotado, la revisión ya pagada se entrega igual", r4.ok && r4.reutilizada && llamadas === 2);
    await prisma.workOrder.update({ where: { id: orden.id }, data: { estimatedHours: 7 } });
    const r5 = await revisarSemana(org, { desde: dia, userId: tec.id }, { analizar });
    revisar("y una nueva con el cupo agotado da un error con motivo, sin llamar al modelo",
      !r5.ok && /agotaron/.test(r5.motivo) && llamadas === 2, r5);

    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", iaComplemento: true },
      select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    try {
      const r6 = await revisarSemana(otra, { desde: dia }, { analizar });
      revisar("otra empresa no recibe revisiones ajenas (sin órdenes: error con motivo)", !r6.ok && llamadas === 2, r6);
    } finally {
      await prisma.organization.delete({ where: { id: otra.id } });
    }
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  if (fallos) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
