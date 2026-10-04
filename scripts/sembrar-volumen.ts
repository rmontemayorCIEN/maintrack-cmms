/**
 * Una empresa con el volumen de un piloto de verdad, para poder MEDIR.
 *
 * Sin esto, todo diagnostico de rendimiento son estimaciones sobre el codigo:
 * se lee una consulta que trae veinte mil renglones y se supone que va a
 * doler, pero nadie lo comprobo. Esta empresa existe para que la maquina lo
 * diga.
 *
 * Lo que siembra NO pasa por los caminos reales del sistema —usa `createMany`
 * a proposito—, asi que NO sirve para probar reglas de negocio: los costos,
 * los kardex y los indicadores de esta empresa son verosimiles, no correctos.
 * Para correccion estan las otras sesenta y cinco pruebas. Esta solo mide.
 *
 *   npx tsx scripts/sembrar-volumen.ts            # crea (o reusa) la empresa
 *   npx tsx scripts/sembrar-volumen.ts --borrar   # la borra
 *
 * Tarda unos minutos y deja ~400 000 renglones en la base de desarrollo.
 */
import { prisma } from "../lib/db";

export const SLUG_VOLUMEN = "volumen-de-prueba";

/** Un piloto de una planta mediana al cabo de un año. */
const CUANTOS = {
  usuarios: 40,
  ubicaciones: 20,
  activos: 800,
  refacciones: 500,
  medidores: 50,
  ordenes: 20_000,
  solicitudes: 5_000,
  movimientos: 60_000,
  lecturas: 100_000,
  auditoria: 30_000,
  avisos: 20_000,
  paros: 3_000,
};

const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);
const azar = (n: number) => Math.floor(Math.random() * n);
const uno = <T>(xs: T[]) => xs[azar(xs.length)];

/** Prisma no acepta cien mil renglones de un golpe; SQLite tampoco. */
async function porTandas<T>(datos: T[], crear: (tanda: T[]) => Promise<unknown>, tanda = 2_000) {
  for (let i = 0; i < datos.length; i += tanda) await crear(datos.slice(i, i + tanda));
}

export async function sembrarVolumen() {
  const ya = await prisma.organization.findUnique({ where: { slug: SLUG_VOLUMEN }, select: { id: true } });
  if (ya) return ya.id;

  const t0 = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Volumen de prueba", slug: SLUG_VOLUMEN, plan: "ENTERPRISE", timezone: "America/Monterrey" },
  });
  const o = org.id;

  await prisma.user.createMany({
    data: Array.from({ length: CUANTOS.usuarios }, (_, i) => ({
      organizationId: o, email: `v${i}@volumen.mx`, name: `Persona ${i}`, passwordHash: "x",
      role: i === 0 ? "OWNER" : i < 4 ? "ADMIN" : i < 10 ? "SUPERVISOR" : i < 34 ? "TECHNICIAN" : "COMPRAS",
      hourlyRate: 120,
    })),
  });
  const usuarios = await prisma.user.findMany({ where: { organizationId: o }, select: { id: true, role: true } });
  const tecnicos = usuarios.filter((u) => u.role === "TECHNICIAN").map((u) => u.id);

  const sitio = await prisma.site.create({ data: { organizationId: o, code: "PL", name: "Planta" } });
  const almacen = await prisma.warehouse.create({ data: { organizationId: o, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
  await prisma.location.createMany({
    data: Array.from({ length: CUANTOS.ubicaciones }, (_, i) => ({ organizationId: o, siteId: sitio.id, code: `U${i}`, name: `Área ${i}` })),
  });
  const ubicaciones = (await prisma.location.findMany({ where: { organizationId: o }, select: { id: true } })).map((x) => x.id);

  await prisma.asset.createMany({
    data: Array.from({ length: CUANTOS.activos }, (_, i) => ({
      organizationId: o, siteId: sitio.id, locationId: uno(ubicaciones),
      code: `EQ-${String(i).padStart(4, "0")}`, name: `${uno(["Bomba", "Motor", "Compresor", "Banda", "Tablero"])} ${i}`,
      criticality: uno(["A", "B", "C"]), status: "OPERATIONAL", purchaseCost: 50_000 + azar(200_000), replacementCost: 80_000 + azar(300_000),
    })),
  });
  const activos = (await prisma.asset.findMany({ where: { organizationId: o }, select: { id: true } })).map((x) => x.id);

  await prisma.part.createMany({
    data: Array.from({ length: CUANTOS.refacciones }, (_, i) => ({
      organizationId: o, code: `REF-${String(i).padStart(4, "0")}`, name: `Refacción ${i}`,
      unit: "pza", unitCost: 50 + azar(4_000), quantityOnHand: azar(60), minQuantity: azar(10),
    })),
  });
  const refacciones = (await prisma.part.findMany({ where: { organizationId: o }, select: { id: true } })).map((x) => x.id);
  await porTandas(refacciones.map((partId) => ({ organizationId: o, partId, warehouseId: almacen.id, quantity: azar(60) })),
    (t) => prisma.partStock.createMany({ data: t }));

  await prisma.meter.createMany({
    data: Array.from({ length: CUANTOS.medidores }, (_, i) => ({
      organizationId: o, assetId: activos[i % activos.length], name: "Horómetro", unit: "h", currentValue: 1_000 + azar(9_000),
    })),
  });
  const medidores = (await prisma.meter.findMany({ where: { organizationId: o }, select: { id: true } })).map((x) => x.id);

  // ── Órdenes. La mayoría cerradas, como en una planta que lleva un año.
  const ESTADOS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CLOSED", "CLOSED", "CANCELLED"];
  await porTandas(
    Array.from({ length: CUANTOS.ordenes }, (_, i) => {
      const estado = uno(ESTADOS);
      const creada = hace(azar(365));
      const terminada = ["COMPLETED", "CLOSED"].includes(estado) ? new Date(creada.getTime() + azar(10) * DIA) : null;
      return {
        organizationId: o, number: `OT-${String(i).padStart(6, "0")}`,
        title: `${uno(["Cambio de", "Revisión de", "Ajuste de", "Limpieza de"])} ${uno(["rodamiento", "sello", "banda", "filtro", "válvula"])}`,
        maintenanceType: uno(["PREVENTIVE", "CORRECTIVE", "CORRECTIVE", "INSPECTION"]),
        status: estado, priority: uno(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        assetId: uno(activos), assignedToId: uno(tecnicos), createdById: usuarios[0].id,
        createdAt: creada, dueDate: new Date(creada.getTime() + azar(20) * DIA),
        completedAt: terminada, closedAt: estado === "CLOSED" ? terminada : null,
        actualHours: terminada ? azar(8) + 1 : 0,
        laborCost: terminada ? azar(2_000) : 0, partsCost: terminada ? azar(5_000) : 0,
        totalCost: terminada ? azar(7_000) : 0,
      };
    }),
    (t) => prisma.workOrder.createMany({ data: t }),
  );
  const ordenes = (await prisma.workOrder.findMany({ where: { organizationId: o }, select: { id: true, assetId: true }, take: 20_000 }));

  await porTandas(
    ordenes.map((w, i) => ({
      workOrderId: w.id, title: `Actividad ${i % 7}`, taskType: "CHECK",
      required: true, position: 1, completedAt: i % 3 !== 0 ? hace(azar(300)) : null,
    })),
    (t) => prisma.workOrderTask.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.solicitudes }, (_, i) => ({
      organizationId: o, number: `SS-${String(i).padStart(6, "0")}`, title: `Reporte ${i}`,
      status: uno(["PENDING", "CONVERTED", "CONVERTED", "REJECTED"]), tipo: uno(["FALLA", "MEJORA", "APOYO"]),
      requestedById: uno(usuarios).id, assetId: uno(activos), createdAt: hace(azar(365)),
    })),
    (t) => prisma.workRequest.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.movimientos }, (_, i) => ({
      organizationId: o, partId: uno(refacciones), warehouseId: almacen.id,
      movementType: uno(["IN", "OUT", "OUT", "OUT"]), quantity: 1 + azar(5), unitCost: 50 + azar(2_000),
      balanceAfter: azar(60), createdAt: hace(azar(365)), reference: `MOV-${i}`,
    })),
    (t) => prisma.stockMovement.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.lecturas }, () => {
      const cuando = hace(azar(365));
      return { organizationId: o, meterId: uno(medidores), value: azar(10_000), readingAt: cuando };
    }),
    (t) => prisma.meterReading.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.paros }, () => {
      const w = uno(ordenes);
      return { organizationId: o, assetId: w.assetId!, workOrderId: w.id, startedAt: hace(azar(365)), minutes: azar(600), planned: azar(3) === 0 };
    }).filter((p) => p.assetId),
    (t) => prisma.downtimeEvent.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.auditoria }, (_, i) => ({
      organizationId: o, userId: uno(usuarios).id, entity: "WorkOrder", entityId: uno(ordenes).id,
      action: uno(["CREATED", "UPDATED", "STATUS_CHANGED", "CLOSED"]), summary: `Movimiento ${i}`, createdAt: hace(azar(365)),
    })),
    (t) => prisma.auditLog.createMany({ data: t }),
  );

  await porTandas(
    Array.from({ length: CUANTOS.avisos }, (_, i) => ({
      organizationId: o, userId: uno(usuarios).id, title: `Aviso ${i}`, body: "Cuerpo del aviso",
      tipo: uno(["OT_VENCIDA", "OT_ASIGNADA", "REFACCION_BAJO_MINIMO"]), entidad: "WorkOrder", entidadId: uno(ordenes).id,
      requiereAccion: i % 3 === 0, atendidaEl: i % 4 === 0 ? hace(azar(30)) : null,
      claveDedup: `vol-${i}`, createdAt: hace(azar(180)),
    })),
    (t) => prisma.notification.createMany({ data: t }),
  );

  console.log(`  sembrada en ${Math.round((Date.now() - t0) / 1000)} s`);
  return o;
}

export async function borrarVolumen() {
  const org = await prisma.organization.findUnique({ where: { slug: SLUG_VOLUMEN }, select: { id: true } });
  if (!org) return;
  // El borrado en cascada del esquema se encarga del resto.
  await prisma.organization.delete({ where: { id: org.id } });
}

if (process.argv[1]?.includes("sembrar-volumen")) {
  (async () => {
    if (process.argv.includes("--borrar")) {
      await borrarVolumen();
      console.log("Empresa de volumen borrada.");
    } else {
      const id = await sembrarVolumen();
      const n = await prisma.workOrder.count({ where: { organizationId: id } });
      console.log(`Empresa de volumen lista (${id}): ${n.toLocaleString("es-MX")} órdenes.`);
    }
    process.exit(0);
  })();
}
