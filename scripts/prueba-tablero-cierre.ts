/**
 * El tablero de cierre: que le falta a cada orden, todas de un golpe.
 *
 * Lo que de verdad vigila: que el tablero diga lo MISMO que el servidor exige
 * al cerrar. Si dijera «lista» y al cerrar el sistema pidiera algo mas, el
 * semaforo habria que verificarlo orden por orden y no serviria de nada.
 * Por eso compara contra `faltaParaCerrar`, que es lo que corre de verdad.
 *
 *   npx tsx scripts/prueba-tablero-cierre.ts
 */
import { prisma } from "../lib/db";
import { tableroDeCierre } from "../lib/tablero-cierre";
import { faltantesDeLaOrden } from "../lib/workorders";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}

async function main() {
  const sello = `prueba-tc-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "BOM-1", name: "Bomba" } });
    const quien = await prisma.user.create({
      data: { organizationId: A.id, email: `u${Date.now()}@x.com`, name: "Técnico", passwordHash: "x", role: "TECHNICIAN" },
    });

    let n = 0;
    const crear = (datos: Record<string, unknown>) =>
      prisma.workOrder.create({
        data: {
          organizationId: A.id, number: `OT-${String(++n).padStart(4, "0")}`, title: `Trabajo ${n}`,
          assetId: equipo.id, assignedToId: quien.id, maintenanceType: "CORRECTIVE",
          ...datos,
        },
      });

    // Completa de verdad: resolución, horas y evidencia.
    const lista = await crear({
      status: "COMPLETED", completedAt: new Date(Date.now() - 5 * 86_400_000),
      maintenanceType: "PREVENTIVE",
      resolution: "Se cambió el sello mecánico y se probó a presión sin fugas.",
      partsCost: 1200,
    });
    await prisma.workOrderLabor.create({ data: { workOrderId: lista.id, userId: quien.id, hours: 3, rate: 200, cost: 600 } });

    // A medias: sin resolución y sin horas.
    const aMedias = await crear({ status: "COMPLETED", completedAt: new Date(Date.now() - 2 * 86_400_000) });

    // Apenas abierta: no debe salir en el tablero.
    const nueva = await crear({ status: "OPEN" });

    console.log("\n1. Que entra al tablero\n");
    const t = await tableroDeCierre(A.id);
    const de = (id: string) => t.filas.find((f) => f.id === id);
    revisar("las completadas entran", Boolean(de(lista.id)) && Boolean(de(aMedias.id)));
    revisar("una recién abierta NO entra: su semáforo sería todo ámbar y no diría nada",
      !de(nueva.id), de(nueva.id)?.number);

    console.log("\n2. El semáforo dice la verdad\n");
    revisar("la que está completa sale sin nada pendiente", de(lista.id)!.faltan === 0, de(lista.id)!.bloques);
    revisar("y sus bloques están en verde",
      de(lista.id)!.bloques.resultado === "hecho" && de(lista.id)!.bloques.tiempo === "hecho",
      de(lista.id)!.bloques);
    revisar("la que va a medias sale con pendientes", de(aMedias.id)!.faltan > 0, de(aMedias.id)!.faltan);
    revisar("y señala CUÁLES bloques la detienen",
      de(aMedias.id)!.bloques.resultado === "falta" && de(aMedias.id)!.bloques.tiempo === "falta",
      de(aMedias.id)!.bloques);
    revisar("con el motivo en palabras, para no adivinar el ámbar",
      de(aMedias.id)!.motivos.some((m) => /solución|resumen/i.test(m)), de(aMedias.id)!.motivos);

    console.log("\n3. LO QUE IMPORTA: dice lo mismo que el servidor al cerrar\n");
    for (const [nombre, id] of [["la completa", lista.id], ["la de a medias", aMedias.id]] as const) {
      const delServidor = await faltantesDeLaOrden(A.id, id);
      const delTablero = de(id)!;
      revisar(`${nombre}: el tablero cuenta lo mismo que el servidor`,
        delTablero.faltan === delServidor.length, { tablero: delTablero.faltan, servidor: delServidor.length });
      revisar(`${nombre}: y son los mismos motivos, no unos parecidos`,
        JSON.stringify(delTablero.motivos) === JSON.stringify(delServidor.map((f: { texto: string }) => f.texto)),
        { tablero: delTablero.motivos.length, servidor: delServidor.length });
    }

    console.log("\n4. El resumen de arriba\n");
    revisar("cuenta cuántas ya se pueden cerrar", t.listas === 1, { listas: t.listas, conPendientes: t.conPendientes });
    revisar("y cuántas traen algo pendiente", t.conPendientes === 1, t.conPendientes);
    revisar("lo que lleva esperando se cuenta desde que se completó",
      de(lista.id)!.diasEsperando === 5, de(lista.id)!.diasEsperando);

    console.log("\n5. El orden en que se atiende\n");
    revisar("lo que lleva más tiempo esperando sale primero",
      t.filas[0].id === lista.id, t.filas.map((f) => f.number));

    console.log("\n6. Cada empresa ve lo suyo\n");
    const otra = await tableroDeCierre(B.id);
    revisar("la otra empresa no ve nada de esta", otra.filas.length === 0, otra.filas.length);
  } finally {
    for (const org of [A.id, B.id]) {
      await prisma.$transaction([
        prisma.workOrderLabor.deleteMany({ where: { workOrder: { organizationId: org } } }),
        prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: org } } }),
        prisma.workOrder.deleteMany({ where: { organizationId: org } }),
        prisma.asset.deleteMany({ where: { organizationId: org } }),
        prisma.site.deleteMany({ where: { organizationId: org } }),
        prisma.user.deleteMany({ where: { organizationId: org } }),
        prisma.organization.delete({ where: { id: org } }),
      ]);
    }
  }

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
