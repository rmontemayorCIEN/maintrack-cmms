/**
 * Reordenar actividades dentro de una orden.
 *
 * El plan y la IA proponen un orden; el gestor de mantenimiento decide el
 * definitivo. Pero lo ya resuelto se queda donde paso: mover una actividad
 * arriba de una que ya se hizo diria que se ejecutaron en un orden que no fue.
 *
 *   npx tsx scripts/prueba-orden-actividades.ts
 */
import { prisma } from "../lib/db";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

/** Lo mismo que hace el endpoint, para poder probarlo sin sesion. */
async function mover(workOrderId: string, taskId: string, direccion: "ARRIBA" | "ABAJO") {
  const tareas = await prisma.workOrderTask.findMany({
    where: { workOrderId }, orderBy: { position: "asc" },
    select: { id: true, position: true, done: true, liberadaAt: true },
  });
  const i = tareas.findIndex((t) => t.id === taskId);
  if (i < 0) return { error: "no es de esta orden" };
  const j = direccion === "ARRIBA" ? i - 1 : i + 1;
  if (j < 0 || j >= tareas.length) return { sinCambio: true };

  const actual = tareas[i], destino = tareas[j];
  if (actual.done || actual.liberadaAt) return { error: "ya resuelta" };
  if (direccion === "ARRIBA" && (destino.done || destino.liberadaAt)) {
    return { error: "arriba de una resuelta" };
  }
  await prisma.$transaction([
    prisma.workOrderTask.update({ where: { id: actual.id }, data: { position: -1 } }),
    prisma.workOrderTask.update({ where: { id: destino.id }, data: { position: actual.position } }),
    prisma.workOrderTask.update({ where: { id: actual.id }, data: { position: destino.position } }),
  ]);
  return { movida: true };
}

async function main() {
  const sello = `prueba-orden-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Gestor", role: "ADMIN", passwordHash: "x" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
      code: "EQ-1", name: "Equipo", status: "OPERATIONAL",
    },
  });

  try {
    const ot = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-1", title: "Preventivo con un correctivo",
        maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", assetId: activo.id, createdById: user.id,
      },
    });
    // Cuatro del plan y, al final, un reporte de falla que se agrego despues.
    for (const [i, t] of ["Bloqueo y etiquetado (LOTO)", "Cambiar filtro", "Engrasar", "Revisar fugas"].entries()) {
      await prisma.workOrderTask.create({
        data: { workOrderId: ot.id, position: i, origen: "PLAN", maintenanceType: "PREVENTIVE", title: t },
      });
    }
    await prisma.workOrderTask.create({
      data: { workOrderId: ot.id, position: 4, origen: "SOLICITUD", maintenanceType: "CORRECTIVE", title: "Fuga por el reten" },
    });

    const lista = async () =>
      (await prisma.workOrderTask.findMany({
        where: { workOrderId: ot.id }, orderBy: { position: "asc" }, select: { title: true, origen: true },
      })).map((t) => t.title);

    console.log("\nEl reporte llega al final, como se agrego");
    revisar("orden inicial", (await lista())[4] === "Fuga por el reten", (await lista()).join(" | "));

    console.log("\nEl gestor lo sube dos lugares");
    const fuga = await prisma.workOrderTask.findFirstOrThrow({ where: { workOrderId: ot.id, title: "Fuga por el reten" } });
    await mover(ot.id, fuga.id, "ARRIBA");
    await mover(ot.id, fuga.id, "ARRIBA");
    const l = await lista();
    revisar("quedo en tercer lugar", l[2] === "Fuga por el reten", l.join(" | "));
    revisar("el bloqueo sigue siendo el primero", l[0] === "Bloqueo y etiquetado (LOTO)");

    console.log("\nNo se puede pasar por encima de lo ya hecho");
    const loto = await prisma.workOrderTask.findFirstOrThrow({ where: { workOrderId: ot.id, title: "Bloqueo y etiquetado (LOTO)" } });
    await prisma.workOrderTask.update({ where: { id: loto.id }, data: { done: true, completedAt: new Date() } });
    const filtro = await prisma.workOrderTask.findFirstOrThrow({ where: { workOrderId: ot.id, title: "Cambiar filtro" } });
    const r1 = await mover(ot.id, filtro.id, "ARRIBA");
    revisar("rechaza subir arriba del bloqueo ya hecho", "error" in r1, "error" in r1 ? r1.error : "SE MOVIO");
    revisar("el bloqueo sigue primero", (await lista())[0] === "Bloqueo y etiquetado (LOTO)");

    console.log("\nUna actividad ya resuelta no se mueve");
    const r2 = await mover(ot.id, loto.id, "ABAJO");
    revisar("rechaza mover la que ya se hizo", "error" in r2, "error" in r2 ? r2.error : "SE MOVIO");

    console.log("\nEn los extremos no pasa nada");
    const ultima = (await prisma.workOrderTask.findFirstOrThrow({
      where: { workOrderId: ot.id }, orderBy: { position: "desc" },
    }));
    const r3 = await mover(ot.id, ultima.id, "ABAJO");
    revisar("bajar la ultima no hace nada", "sinCambio" in r3);

    console.log("\nLas posiciones quedan sanas: sin huecos ni repetidas");
    const pos = (await prisma.workOrderTask.findMany({
      where: { workOrderId: ot.id }, orderBy: { position: "asc" }, select: { position: true },
    })).map((t) => t.position);
    revisar("cinco posiciones distintas", new Set(pos).size === 5, pos.join(","));
    revisar("ninguna quedo en el valor temporal", !pos.includes(-1));
  } finally {
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
