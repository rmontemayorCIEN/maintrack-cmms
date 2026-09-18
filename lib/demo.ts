/**
 * Cómo arranca una empresa, y los datos de demostración.
 *
 * Tres maneras de empezar, y la empresa elige:
 *
 *  - **Vacía**: solo los catálogos base de su tipo de instalación, que ya
 *    recibió al darse de alta. Todo lo demás lo captura o lo importa.
 *  - **Estructura recomendada**: además, su primer sitio —con el nombre que se
 *    usa en su giro— y el almacén general.
 *  - **Demostración**: la estructura, y encima un juego chico de equipos, un
 *    plan con sus actividades, refacciones y un proveedor, para ver el sistema
 *    funcionando antes de capturar lo propio.
 *
 * Los datos de demostración son un LOTE de tipo DEMO, igual que una
 * importación: llevan «[DEMO]» en el nombre para que nadie los confunda, y se
 * quitan con la misma reversión segura (`lib/lotes.ts`), que no borra lo que
 * ya se usó. Y mientras existan, la empresa no puede declararse en operación:
 * así los ejemplos nunca se cuelan en los indicadores de una empresa real.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import { aplicarMovimiento } from "./almacen";
import { asignarPlan } from "./asignaciones";
import { catalogosPara, sembrarCatalogosEstandar, sembrarEstructura } from "./catalogos-estandar";
import { diagnosticarReversion, revertirLote } from "./lotes";

export const MARCA_DEMO = "[DEMO]";
export const REFERENCIA_DEMO = "Datos de demostración";

export type ModoDeInicio = "VACIA" | "ESTRUCTURA" | "DEMO";

export class ErrorDeInicio extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

/** Los lotes de demostración que siguen vivos. */
export async function lotesDemoVivos(organizationId: string) {
  return prisma.importBatch.findMany({
    where: { organizationId, tipo: "DEMO", estado: { in: ["IMPORTADO", "REVERSION_PARCIAL"] } },
    select: { id: true, estado: true, creados: true, createdAt: true },
  });
}

export async function hayDemo(organizationId: string) {
  return (await lotesDemoVivos(organizationId)).length > 0;
}

/** Arranca la empresa del modo elegido. Solo antes de declararse en operación. */
export async function iniciarEmpresa(p: { organizationId: string; userId: string; modo: ModoDeInicio }) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: p.organizationId },
    select: { tipoInstalacion: true, operandoDesde: true },
  });
  if (org.operandoDesde) {
    throw new ErrorDeInicio("La empresa ya está en operación: los datos de ejemplo ya no se pueden cargar.", 409);
  }

  let detalle: Record<string, unknown> = {};
  if (p.modo === "ESTRUCTURA" || p.modo === "DEMO") {
    detalle.catalogos = await sembrarCatalogosEstandar(p.organizationId, org.tipoInstalacion);
    detalle.estructura = await sembrarEstructura(p.organizationId, org.tipoInstalacion);
  }
  if (p.modo === "DEMO") {
    if (await hayDemo(p.organizationId)) {
      throw new ErrorDeInicio("Ya hay datos de demostración cargados. Quítelos antes de cargar otros.", 409);
    }
    detalle = { ...detalle, demo: await cargarDemo(p.organizationId, p.userId, org.tipoInstalacion) };
  }

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Organization", entityId: p.organizationId,
    action: p.modo === "DEMO" ? "DEMO_CREATED" : "SETUP_STARTED",
    summary: p.modo === "VACIA"
      ? "Puesta en marcha: se eligió empezar vacía"
      : p.modo === "ESTRUCTURA"
        ? "Puesta en marcha: se cargó la estructura y los catálogos recomendados"
        : "Puesta en marcha: se cargaron datos de demostración",
    changes: detalle,
  });
  return detalle;
}

/**
 * El juego de demostración, en una transacción y como lote.
 *
 * Chico a propósito: tres equipos, un plan con dos actividades, dos
 * refacciones con existencia y un proveedor. Suficiente para ver una orden
 * generarse; poco para que alguien lo confunda con su planta.
 */
async function cargarDemo(organizationId: string, userId: string, tipo: string | null) {
  const categoriasDelTipo = catalogosPara(tipo).categorias.slice(0, 3);

  return prisma.$transaction(async (tx) => {
    const lote = await tx.importBatch.create({
      data: { organizationId, userId, tipo: "DEMO", estado: "IMPORTADO", archivoNombre: "Datos de demostración" },
    });
    const registros: Array<{ entity: string; entityId: string }> = [];
    const anota = (entity: string, entityId: string) => registros.push({ entity, entityId });

    const almacen = await tx.warehouse.findFirst({
      where: { organizationId, active: true }, orderBy: [{ esGeneral: "desc" }], select: { id: true },
    });

    const sitio = await tx.site.create({
      data: { organizationId, code: "DEMO", name: `${MARCA_DEMO} Sitio de ejemplo`, country: "Mexico" },
      select: { id: true },
    });
    anota("Site", sitio.id);
    const ubicacion = await tx.location.create({
      data: { organizationId, siteId: sitio.id, code: "DEMO-A", name: `${MARCA_DEMO} Área de ejemplo` },
      select: { id: true },
    });
    anota("Location", ubicacion.id);

    const categorias = await tx.assetCategory.findMany({
      where: { organizationId, code: { in: categoriasDelTipo.map((c) => c[0]) } },
      select: { id: true, code: true, name: true },
    });
    const activos: string[] = [];
    for (let i = 0; i < 3; i++) {
      const cat = categorias[i % Math.max(categorias.length, 1)];
      const a = await tx.asset.create({
        data: {
          organizationId, siteId: sitio.id, locationId: ubicacion.id, categoryId: cat?.id ?? null,
          code: `DEMO-${i + 1}`, name: `${MARCA_DEMO} ${cat?.name ?? "Equipo"} ${i + 1}`,
          criticality: i === 0 ? "A" : "B", status: "OPERATIONAL",
        },
        select: { id: true },
      });
      anota("Asset", a.id);
      activos.push(a.id);
    }

    const proveedor = await tx.supplier.create({
      data: { organizationId, name: `${MARCA_DEMO} Proveedor de ejemplo`, leadTimeDays: 5 },
      select: { id: true },
    });
    anota("Supplier", proveedor.id);

    const unidad = (await tx.partUnit.findFirst({ where: { organizationId }, orderBy: { code: "asc" }, select: { code: true } }))?.code ?? "pza";
    for (const [code, name, costo, existencia] of [["DEMO-R1", "Filtro de ejemplo", 180, 6], ["DEMO-R2", "Lubricante de ejemplo", 95, 10]] as const) {
      const parte = await tx.part.create({
        data: {
          organizationId, code, name: `${MARCA_DEMO} ${name}`, unit: unidad, unitCost: costo,
          minQuantity: 2, maxQuantity: 12, supplierId: proveedor.id, quantityOnHand: 0,
        },
        select: { id: true },
      });
      anota("Part", parte.id);
      if (almacen) {
        await aplicarMovimiento({
          organizationId, partId: parte.id, warehouseId: almacen.id, tipo: "IN",
          cantidad: existencia, costoUnitario: costo, referencia: REFERENCIA_DEMO,
        }, tx);
      }
    }

    const plan = await tx.maintenancePlan.create({
      data: {
        organizationId, name: `${MARCA_DEMO} Revisión mensual de ejemplo`, assetId: activos[0],
        maintenanceType: "PREVENTIVE", triggerType: "CALENDAR", intervalDays: 30,
        estimatedHours: 1, priority: "MEDIUM", nextDueDate: new Date(Date.now() + 7 * 86_400_000),
        tasks: {
          create: [
            { position: 0, title: "Inspección visual y limpieza" },
            { position: 1, title: "Revisar ruidos, vibración y temperatura" },
          ],
        },
      },
      select: { id: true },
    });
    anota("MaintenancePlan", plan.id);
    await asignarPlan({
      organizationId, planId: plan.id,
      equipos: [{ assetId: activos[0], desde: new Date(Date.now() + 7 * 86_400_000), desdeEsUltima: false }],
      db: tx,
    });

    await tx.importRecord.createMany({
      data: registros.map((r) => ({ batchId: lote.id, entity: r.entity, entityId: r.entityId, accion: "CREATED" })),
    });
    await tx.importBatch.update({ where: { id: lote.id }, data: { creados: registros.length, leidos: registros.length } });
    return { loteId: lote.id, registros: registros.length };
  }, { timeout: 120_000, maxWait: 20_000 });
}

/** Qué se borraría al quitar la demostración, sin borrar nada. */
export async function vistaPreviaQuitarDemo(organizationId: string) {
  const lotes = await lotesDemoVivos(organizationId);
  const diagnosticos = await Promise.all(lotes.map((l) => diagnosticarReversion(organizationId, l.id)));
  return {
    aBorrar: diagnosticos.flatMap((d) => d.aBorrar),
    bloqueados: diagnosticos.flatMap((d) => d.bloqueados),
  };
}

/** Quita los datos de demostración: lo que no se usó; lo usado se lista. */
export async function quitarDemo(p: { organizationId: string; userId: string }) {
  const lotes = await lotesDemoVivos(p.organizationId);
  if (!lotes.length) throw new ErrorDeInicio("No hay datos de demostración que quitar.", 404);
  let borrados = 0;
  const bloqueados: Awaited<ReturnType<typeof revertirLote>>["bloqueados"] = [];
  for (const l of lotes) {
    const r = await revertirLote({ organizationId: p.organizationId, loteId: l.id, userId: p.userId });
    borrados += r.borrados;
    bloqueados.push(...r.bloqueados);
  }
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Organization", entityId: p.organizationId, action: "DEMO_REMOVED",
    summary: `Datos de demostración: ${borrados} registros eliminados` +
      (bloqueados.length ? `, ${bloqueados.length} se quedaron porque ya se usaron` : ""),
  });
  return { borrados, bloqueados };
}
