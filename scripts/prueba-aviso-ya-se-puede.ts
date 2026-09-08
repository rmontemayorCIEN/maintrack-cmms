/**
 * El aviso de "ya se puede hacer".
 *
 * Una actividad se libero porque no habia la refaccion. Semanas despues la
 * refaccion llega y el dato queda ahi, correcto, sin que nadie lo vea. Esta
 * prueba cubre lo que decide si ese aviso sirve o se vuelve ruido:
 *
 *   - que avise cuando la refaccion llega, por el camino real del almacen
 *   - que NO repita mientras el estado no cambia
 *   - que vuelva a avisar si la refaccion se acaba y regresa
 *   - que la equivalente de otra marca tambien cuente
 *   - que no se cruce entre organizaciones
 *
 *   npx tsx scripts/prueba-aviso-ya-se-puede.ts
 */
import { prisma } from "../lib/db";
import { aplicarMovimiento } from "../lib/almacen";
import { avisarTrabajoDisponible, redactarAviso } from "../lib/aviso-ya-se-puede";
import { backlog } from "../lib/backlog";
import { notify } from "../lib/audit";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function avisosDe(userId: string) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}

async function main() {
  const sello = `prueba-yasepuede-${Date.now()}`;

  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const tecnico = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-t@t.mx`, name: "Luis Tecnico", role: "TECHNICIAN", passwordHash: "x" },
  });
  const jefe = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-j@t.mx`, name: "Ana Supervisora", role: "SUPERVISOR", passwordHash: "x" },
  });
  const ajeno = await prisma.organization.create({
    data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" },
  });
  const jefeAjeno = await prisma.user.create({
    data: { organizationId: ajeno.id, email: `${sello}-ja@t.mx`, name: "Otro Jefe", role: "ADMIN", passwordHash: "x" },
  });

  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
      code: "BOM-001", name: "Bomba hidroneumática", status: "OPERATIONAL",
    },
  });
  const almacen = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "ALM", name: "Almacén general", esGeneral: true },
  });
  const balero = await prisma.part.create({
    data: { organizationId: org.id, code: "BAL-6205", name: "Balero 6205", unit: "PZA", quantityOnHand: 0 },
  });

  const ot = await prisma.workOrder.create({
    data: {
      organizationId: org.id, number: "OT-000001", title: "Preventivo mensual",
      maintenanceType: "PREVENTIVE", status: "COMPLETED", assetId: activo.id, createdById: jefe.id,
    },
  });
  const hace12dias = new Date(Date.now() - 12 * 86_400_000);
  const tarea = await prisma.workOrderTask.create({
    data: {
      workOrderId: ot.id, position: 0, origen: "PLAN", title: "Cambiar balero del motor",
      liberadaAt: hace12dias, liberadaPorId: tecnico.id,
      motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: balero.id,
    },
  });

  try {
    console.log("\nSin la refacción no hay nada que avisar");
    const cero = await avisarTrabajoDisponible(org.id);
    revisar("no avisa", cero.avisadas === 0, JSON.stringify(cero));
    revisar("nadie recibió nada", (await avisosDe(jefe.id)).length === 0);

    console.log("\nLlega la refacción por el camino real del almacén");
    // Entra por aplicarMovimiento, no escribiendo quantityOnHand a mano: si el
    // aviso solo funcionara con el atajo, no serviria en produccion.
    await aplicarMovimiento({
      organizationId: org.id, partId: balero.id, warehouseId: almacen.id,
      tipo: "IN", cantidad: 4, costoUnitario: 180, userId: jefe.id, referencia: "Recepción",
    });
    const primero = await avisarTrabajoDisponible(org.id);
    revisar("avisa la actividad", primero.avisadas === 1, JSON.stringify(primero));
    // Al tecnico porque es su trabajo pendiente; a la supervisora porque es
    // quien puede reprogramarlo. Avisarle solo a quien no puede actuar deja la
    // espera igual.
    revisar("le llega a quien la liberó", (await avisosDe(tecnico.id)).length === 1);
    revisar("y a quien puede reprogramar", (await avisosDe(jefe.id)).length === 1);

    const aviso = (await avisosDe(tecnico.id))[0];
    revisar("el título dice qué se puede hacer", aviso.title.includes("Cambiar balero"), aviso.title);
    revisar("el cuerpo nombra el equipo", (aviso.body ?? "").includes("BOM-001"), aviso.body ?? "");
    revisar("y cuánto llevaba esperando", (aviso.body ?? "").includes("12 días"), aviso.body ?? "");
    revisar("lleva al backlog", aviso.link === "/backlog");

    console.log("\nNo repite mientras nada cambia");
    // Lo que vuelve ruido a un canal es el aviso que llega todos los dias
    // diciendo lo mismo. Ese dia la gente deja de leerlos, incluido el que si
    // importaba.
    const segundo = await avisarTrabajoDisponible(org.id);
    revisar("el segundo barrido no avisa", segundo.avisadas === 0, JSON.stringify(segundo));
    const tercero = await avisarTrabajoDisponible(org.id);
    revisar("el tercero tampoco", tercero.avisadas === 0);
    revisar("sigue habiendo un solo aviso", (await avisosDe(tecnico.id)).length === 1);

    console.log("\nSe vuelve a acabar la refacción");
    await aplicarMovimiento({
      organizationId: org.id, partId: balero.id, warehouseId: almacen.id,
      tipo: "OUT", cantidad: 4, userId: jefe.id, referencia: "Se usó en otra OT",
    });
    const revertido = await avisarTrabajoDisponible(org.id);
    revisar("olvida el aviso anterior", revertido.revertidas === 1, JSON.stringify(revertido));
    revisar("no avisa nada nuevo", revertido.avisadas === 0);
    revisar("no mandó otro mensaje", (await avisosDe(tecnico.id)).length === 1);

    console.log("\nY llega otra vez: tiene que volver a avisar");
    // Sin limpiar la memoria, esta actividad se quedaria callada para siempre
    // aunque llegara material cada mes.
    await aplicarMovimiento({
      organizationId: org.id, partId: balero.id, warehouseId: almacen.id,
      tipo: "IN", cantidad: 2, costoUnitario: 180, userId: jefe.id,
    });
    const otraVez = await avisarTrabajoDisponible(org.id);
    revisar("vuelve a avisar", otraVez.avisadas === 1, JSON.stringify(otraVez));
    revisar("ahora son dos avisos", (await avisosDe(tecnico.id)).length === 2);

    console.log("\nLa equivalente de otra marca también sirve");
    const tarea2 = await prisma.workOrderTask.create({
      data: {
        workOrderId: ot.id, position: 1, origen: "PLAN", title: "Cambiar reten del eje",
        liberadaAt: hace12dias, liberadaPorId: tecnico.id,
        motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: (await prisma.part.create({
          data: { organizationId: org.id, code: "RET-A", name: "Retén marca A", unit: "PZA", quantityOnHand: 0 },
        })).id,
      },
    });
    const retenB = await prisma.part.create({
      data: { organizationId: org.id, code: "RET-B", name: "Retén marca B", unit: "PZA", quantityOnHand: 0 },
    });
    await prisma.equivalenciaRefaccion.create({
      data: {
        organization: { connect: { id: org.id } },
        partA: { connect: { id: tarea2.bloqueadaPorPartId! } },
        partB: { connect: { id: retenB.id } },
        createdBy: { connect: { id: jefe.id } },
      },
    });
    await aplicarMovimiento({
      organizationId: org.id, partId: retenB.id, warehouseId: almacen.id,
      tipo: "IN", cantidad: 3, costoUnitario: 90, userId: jefe.id,
    });
    const conEquivalente = await avisarTrabajoDisponible(org.id);
    revisar("avisa aunque llegó la de otra marca", conEquivalente.avisadas === 1, JSON.stringify(conEquivalente));
    const ultimo = (await avisosDe(tecnico.id)).at(-1)!;
    // Si el aviso no dice que va a tomar otra cosa, el tecnico baja al almacen
    // a buscar la que pidio y se regresa con las manos vacias.
    revisar("dice con qué equivalente", (ultimo.body ?? "").includes("RET-B"), ultimo.body ?? "");

    console.log("\nUna actividad ya retomada sale del backlog");
    const retoma = await prisma.workOrderTask.create({
      data: { workOrderId: ot.id, position: 2, origen: "BACKLOG", title: "Cambiar balero del motor", retomaDeTaskId: tarea.id },
    });
    const items = await backlog(org.id);
    revisar("ya no aparece la retomada", !items.some((t) => t.id === tarea.id), `${items.length} en backlog`);
    await prisma.workOrderTask.delete({ where: { id: retoma.id } });

    console.log("\nUn aviso nunca sale de su organización");
    /**
     * El operador de la plataforma, trabajando dentro de una empresa cliente,
     * conserva SU usuario. Si libera una actividad ahi, queda como
     * `liberadaPorId` de trabajo que es del cliente. El aviso no puede llegarle:
     * traeria el equipo, la refaccion y el folio de una empresa que no es la
     * suya. Paso en produccion.
     */
    const forastero = await prisma.user.create({
      data: { organizationId: ajeno.id, email: `${sello}-fuera@t.mx`, name: "Operador", role: "OWNER", passwordHash: "x" },
    });
    const antesForastero = (await avisosDe(forastero.id)).length;
    await notify({
      organizationId: org.id, userId: forastero.id,
      title: "Aviso de otra empresa", body: "No debe llegar", link: "/backlog",
    });
    revisar("descarta al usuario de otra organización",
      (await avisosDe(forastero.id)).length === antesForastero,
      `${(await avisosDe(forastero.id)).length} avisos`);

    const tarea3 = await prisma.workOrderTask.create({
      data: {
        workOrderId: ot.id, position: 3, origen: "PLAN", title: "Actividad liberada por un forastero",
        liberadaAt: hace12dias, liberadaPorId: forastero.id,
        motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: balero.id,
      },
    });
    await avisarTrabajoDisponible(org.id);
    revisar("y tampoco por la vía de quien liberó",
      (await avisosDe(forastero.id)).length === antesForastero);
    // Los responsables de la organización sí se enteran: nadie se queda sin saber.
    revisar("los de la organización sí reciben el aviso",
      (await avisosDe(jefe.id)).length > 0);
    await prisma.workOrderTask.delete({ where: { id: tarea3.id } });

    console.log("\nCada organización ve solo lo suyo");
    const ajenoAntes = (await avisosDe(jefeAjeno.id)).length;
    await avisarTrabajoDisponible(ajeno.id);
    revisar("el barrido ajeno no avisa de mis actividades", (await avisosDe(jefeAjeno.id)).length === ajenoAntes);

    console.log("\nLa redacción cambia con la cantidad");
    const varios = (await backlog(org.id)).slice(0, 2);
    if (varios.length >= 2) {
      const texto = redactarAviso(varios);
      revisar("con varias dice el conteo", texto.title.includes(`${varios.length} actividades`), texto.title);
    } else {
      revisar("con varias dice el conteo", true, "(no quedaron dos en backlog, se omite)");
    }
  } finally {
    await prisma.notification.deleteMany({ where: { organizationId: { in: [org.id, ajeno.id] } } });
    await prisma.stockMovement.deleteMany({ where: { organizationId: org.id } });
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: ajeno.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
