import type { Prisma } from "@prisma/client";
import { filtroDeActividadesDeLaOrden } from "./plan-tasks";
import { prisma } from "./db";
import { ErrorDeAlmacen, aplicarMovimiento } from "./almacen";
import { recalcWorkOrder } from "./workorders";
import { ESTADOS, estadoSegunRenglones, type Estado } from "./requisiciones-datos";

/**
 * Requisicion de material: el circuito entre mantenimiento y almacen.
 *
 * Se pide, se surte —completo o en partes— y lo que sobra se devuelve. El vale
 * de salida no es un documento aparte: es el conjunto de movimientos ligados a
 * la requisicion, cada uno con su fecha y a quien se le entrego. Por eso el
 * saldo del almacen y lo surtido en la requisicion no se pueden separar: los
 * mueve la misma funcion.
 */

// El catalogo y las reglas puras viven en `requisiciones-datos.ts` para que las
// pantallas del navegador no arrastren Prisma ni los avisos al celular.
export {
  MOTIVOS, URGENCIAS, ESTADOS, motivoDeLaOrden, estadoSegunRenglones,
  type Motivo, type Urgencia, type Estado,
} from "./requisiciones-datos";

export class ErrorDeRequisicion extends Error {}

type Cliente = Prisma.TransactionClient;

async function cargar(tx: Cliente, id: string, organizationId: string) {
  const req = await tx.materialRequest.findFirst({
    where: { id, organizationId },
    include: { renglones: true },
  });
  if (!req) throw new ErrorDeRequisicion("Requisición no encontrada");
  return req;
}

async function sincronizarEstado(tx: Cliente, requestId: string) {
  const renglones = await tx.materialRequestLine.findMany({
    where: { requestId },
    select: { cantidadSolicitada: true, cantidadSurtida: true },
  });
  await tx.materialRequest.update({
    where: { id: requestId },
    data: { estado: estadoSegunRenglones(renglones) },
  });
}

/**
 * Surte renglones de una requisicion.
 *
 * Cada renglon surtido descuenta del almacen de la requisicion y deja su
 * movimiento ligado, con a quien se le entrego. Si un renglon no alcanza, no
 * se surte ninguno: media entrega deja al tecnico sin saber que le falta y al
 * almacen con un saldo que no cuadra contra el papel.
 */
export async function surtir(params: {
  organizationId: string;
  requestId: string;
  userId: string;
  entregadoA: string;
  renglones: Array<{ lineId: string; cantidad: number }>;
}) {
  if (!params.entregadoA.trim()) {
    throw new ErrorDeRequisicion("Falta indicar a quien se le entrega");
  }

  return prisma.$transaction(async (tx) => {
    const req = await cargar(tx, params.requestId, params.organizationId);
    if (req.estado === "CANCELADA" || req.estado === "CERRADA") {
      throw new ErrorDeRequisicion(`La requisicion ${req.folio} esta ${ESTADOS[req.estado as Estado].toLowerCase()}`);
    }

    for (const entrega of params.renglones) {
      if (entrega.cantidad <= 0) continue;
      const renglon = req.renglones.find((r) => r.id === entrega.lineId);
      if (!renglon) throw new ErrorDeRequisicion("Renglón que no pertenece a esta requisición");

      const pendiente = renglon.cantidadSolicitada - renglon.cantidadSurtida;
      if (entrega.cantidad > pendiente + 0.0001) {
        throw new ErrorDeRequisicion(
          `De ${renglon.descripcion} solo faltan ${pendiente} por surtir y se intentan entregar ${entrega.cantidad}`,
        );
      }
      if (!renglon.partId) {
        throw new ErrorDeRequisicion(
          `"${renglon.descripcion}" no esta en el catalogo de refacciones: no se puede surtir del almacen. Dela de alta o solicitela a compras.`,
        );
      }

      await aplicarMovimiento(
        {
          organizationId: params.organizationId,
          partId: renglon.partId,
          warehouseId: req.warehouseId,
          tipo: "OUT",
          cantidad: entrega.cantidad,
          workOrderId: req.workOrderId,
          materialRequestId: req.id,
          entregadoA: params.entregadoA.trim(),
          userId: params.userId,
          referencia: `Vale ${req.folio}`,
        },
        tx,
      );

      /**
       * El renglon se actualiza SOLO si sigue como se leyo.
       *
       * Dos entregas simultaneas —doble clic, dos personas en el almacen—
       * leian el mismo pendiente y las dos lo daban por bueno: se entregaba de
       * mas y el vale terminaba con mas surtido que solicitado.
       */
      const avance = await tx.materialRequestLine.updateMany({
        where: { id: renglon.id, cantidadSurtida: renglon.cantidadSurtida },
        data: { cantidadSurtida: { increment: entrega.cantidad } },
      });
      if (avance.count === 0) {
        throw new ErrorDeRequisicion(
          `Alguien más surtió «${renglon.descripcion}» mientras tanto. Vuelva a abrir el vale para ver lo que falta.`,
        );
      }

      // Lo surtido contra una OT se asienta tambien como consumo de esa orden:
      // es lo que despues permite decir cuanto costo mantener cada equipo.
      if (req.workOrderId) {
        const part = await tx.part.findUnique({ where: { id: renglon.partId }, select: { unitCost: true } });
        await tx.workOrderPart.create({
          data: {
            workOrderId: req.workOrderId,
            partId: renglon.partId,
            quantity: entrega.cantidad,
            unitCost: part?.unitCost ?? 0,
            cost: entrega.cantidad * (part?.unitCost ?? 0),
          },
        });
      }
    }

    await sincronizarEstado(tx, req.id);
    const actualizada = await cargar(tx, req.id, params.organizationId);
    return { req: actualizada, workOrderId: req.workOrderId };
  }).then(async ({ req, workOrderId }) => {
    /**
     * El costo de la orden se recalcula despues de entregar.
     *
     * Antes se creaba el cargo y ahi quedaba: la orden seguia diciendo que las
     * refacciones costaron lo de antes —cero, en OT-000001 de produccion—
     * hasta que algo mas la recalculara. El costo por equipo salia corto.
     */
    if (workOrderId) await recalcWorkOrder(workOrderId);
    return req;
  });
}

/**
 * Devuelve al almacen lo que se surtio y no se uso.
 *
 * Es el movimiento que casi ningun sistema tiene y donde muere la exactitud
 * del inventario: el tecnico pidio cinco, uso tres, y las dos que sobran se
 * quedan en su caja mientras el sistema dice que hay cero.
 */
export async function devolver(params: {
  organizationId: string;
  requestId: string;
  userId: string;
  devuelvePor: string;
  renglones: Array<{ lineId: string; cantidad: number }>;
}) {
  return prisma.$transaction(async (tx) => {
    const req = await cargar(tx, params.requestId, params.organizationId);
    if (req.estado === "CANCELADA") throw new ErrorDeRequisicion("La requisición esta cancelada");

    for (const dev of params.renglones) {
      if (dev.cantidad <= 0) continue;
      const renglon = req.renglones.find((r) => r.id === dev.lineId);
      if (!renglon) throw new ErrorDeRequisicion("Renglón que no pertenece a esta requisición");

      const enPoder = renglon.cantidadSurtida - renglon.cantidadDevuelta;
      if (dev.cantidad > enPoder + 0.0001) {
        throw new ErrorDeRequisicion(
          `De ${renglon.descripcion} solo hay ${enPoder} sin devolver y se intentan regresar ${dev.cantidad}`,
        );
      }
      if (!renglon.partId) throw new ErrorDeRequisicion("Ese renglón no salio del almacén");

      await aplicarMovimiento(
        {
          organizationId: params.organizationId,
          partId: renglon.partId,
          warehouseId: req.warehouseId,
          tipo: "RETURN",
          cantidad: dev.cantidad,
          workOrderId: req.workOrderId,
          materialRequestId: req.id,
          entregadoA: params.devuelvePor.trim() || null,
          userId: params.userId,
          referencia: `Devolucion ${req.folio}`,
        },
        tx,
      );

      const avance = await tx.materialRequestLine.updateMany({
        where: { id: renglon.id, cantidadDevuelta: renglon.cantidadDevuelta },
        data: { cantidadDevuelta: { increment: dev.cantidad } },
      });
      if (avance.count === 0) {
        throw new ErrorDeRequisicion(
          `Alguien más registró una devolución de «${renglon.descripcion}» mientras tanto. Vuelva a abrir el vale.`,
        );
      }

      /**
       * Lo devuelto deja de ser consumo de la orden.
       *
       * El cargo original NO se borra —es lo que de verdad salio del almacen
       * ese dia— pero se le anota lo regresado y el costo de la orden baja a
       * lo que se uso. Sin esto la orden pagaba material que volvio al estante:
       * en produccion, RM-000001 dejo 2 piezas cargadas a OT-000001 habiendo
       * devuelto una.
       */
      if (req.workOrderId) {
        let porRepartir = dev.cantidad;
        const cargos = await tx.workOrderPart.findMany({
          where: { workOrderId: req.workOrderId, partId: renglon.partId },
          orderBy: { id: "asc" },
        });
        for (const cargo of cargos) {
          if (porRepartir <= 0) break;
          const disponible = cargo.quantity - cargo.devuelto;
          if (disponible <= 0) continue;
          const baja = Math.min(disponible, porRepartir);
          await tx.workOrderPart.update({
            where: { id: cargo.id },
            data: { devuelto: cargo.devuelto + baja, cost: (cargo.quantity - cargo.devuelto - baja) * cargo.unitCost },
          });
          porRepartir -= baja;
        }
      }
    }

    const actualizada = await cargar(tx, req.id, params.organizationId);
    return { req: actualizada, workOrderId: req.workOrderId };
  }).then(async ({ req, workOrderId }) => {
    if (workOrderId) await recalcWorkOrder(workOrderId);
    return req;
  });
}

/** Cierra la requisicion: ya no se espera mas movimiento contra ella. */
export async function cerrar(organizationId: string, requestId: string) {
  const req = await prisma.materialRequest.findFirst({
    where: { id: requestId, organizationId },
    select: { id: true, estado: true },
  });
  if (!req) throw new ErrorDeRequisicion("Requisición no encontrada");
  if (req.estado === "CANCELADA") throw new ErrorDeRequisicion("La requisición esta cancelada");
  return prisma.materialRequest.update({
    where: { id: req.id },
    data: { estado: "CERRADA", cerradaEl: new Date() },
  });
}

/** Cancela una requisicion que todavia no ha surtido nada. */
export async function cancelar(organizationId: string, requestId: string) {
  const req = await prisma.materialRequest.findFirst({
    where: { id: requestId, organizationId },
    include: { renglones: { select: { cantidadSurtida: true } } },
  });
  if (!req) throw new ErrorDeRequisicion("Requisición no encontrada");
  if (req.renglones.some((r) => r.cantidadSurtida > 0)) {
    throw new ErrorDeRequisicion(
      "Ya se surtio material contra esta requisición. Devuelva lo entregado y cierrela en vez de cancelarla.",
    );
  }
  return prisma.materialRequest.update({ where: { id: req.id }, data: { estado: "CANCELADA" } });
}

export { ErrorDeAlmacen };

/**
 * Lo que el plan pide para esta orden, contra lo que ya se movio.
 *
 * Una orden preventiva no deberia obligar a capturar refacciones que el plan
 * ya definio: son el mismo dato, escrito cuando se diseño la rutina. Esto
 * arma la requisicion sola y deja al usuario solo revisar y enviar.
 *
 * Se descuenta lo ya pedido y lo ya consumido para no duplicar: si el tecnico
 * pidio la mitad ayer, hoy solo falta la otra mitad.
 */
export async function refaccionesDelPlan(organizationId: string, workOrderId: string) {
  const orden = await prisma.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    select: { id: true, planId: true, plan: { select: { name: true } } },
  });
  if (!orden) return null;

  // Solo las actividades que trae ESTA orden. Pedir las del plan completo
  // mandaba al almacen, cada mes, los rodamientos de la revision anual.
  const filtro = await filtroDeActividadesDeLaOrden(orden.id);
  if (!filtro) return null;
  const tareas = await prisma.planTask.findMany({
    where: { ...filtro, plan: { organizationId } },
    orderBy: { position: "asc" },
    select: {
      title: true,
      plan: { select: { name: true } },
      parts: {
        select: {
          quantity: true,
          part: { select: { id: true, code: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!tareas.length) return null;
  const nombrePlan =
    orden.plan?.name ?? ([...new Set(tareas.map((t) => t.plan.name))].join(" · ") || "Plan");

  // Lo que pide el plan, sumando la misma refaccion si aparece en varias
  // actividades: al almacen se le pide una vez, no una por actividad.
  const pide = new Map<string, { code: string; name: string; unit: string; cantidad: number; actividades: string[] }>();
  for (const t of tareas) {
    for (const p of t.parts) {
      const previo = pide.get(p.part.id);
      if (previo) {
        previo.cantidad += p.quantity;
        if (!previo.actividades.includes(t.title)) previo.actividades.push(t.title);
      } else {
        pide.set(p.part.id, {
          code: p.part.code, name: p.part.name, unit: p.part.unit,
          cantidad: p.quantity, actividades: [t.title],
        });
      }
    }
  }
  if (!pide.size) return { plan: nombrePlan, renglones: [] };

  const ids = [...pide.keys()];
  const [pedidas, consumidas] = await Promise.all([
    // Lo ya solicitado contra esta orden, sin contar lo cancelado.
    prisma.materialRequestLine.findMany({
      where: {
        partId: { in: ids },
        request: { workOrderId: orden.id, estado: { not: "CANCELADA" } },
      },
      select: { partId: true, cantidadSolicitada: true },
    }),
    prisma.workOrderPart.findMany({
      where: { workOrderId: orden.id, partId: { in: ids } },
      select: { partId: true, quantity: true },
    }),
  ]);

  const suma = (filas: Array<{ partId: string | null; cantidadSolicitada?: number; quantity?: number }>) => {
    const m = new Map<string, number>();
    for (const f of filas) {
      if (!f.partId) continue;
      m.set(f.partId, (m.get(f.partId) ?? 0) + (f.cantidadSolicitada ?? f.quantity ?? 0));
    }
    return m;
  };
  const yaPedido = suma(pedidas);
  const yaConsumido = suma(consumidas);

  return {
    plan: nombrePlan,
    renglones: [...pide.entries()].map(([partId, v]) => {
      const pedido = yaPedido.get(partId) ?? 0;
      const consumido = yaConsumido.get(partId) ?? 0;
      // Lo consumido pudo entrar sin requisicion —cargado a mano en la orden—
      // asi que se toma el mayor de los dos para no volver a pedirlo.
      const cubierto = Math.max(pedido, consumido);
      return {
        partId, code: v.code, name: v.name, unidad: v.unit,
        actividades: v.actividades,
        pide: v.cantidad,
        yaPedido: pedido,
        yaConsumido: consumido,
        falta: Math.max(0, v.cantidad - cubierto),
      };
    }),
  };
}
