/**
 * El material visto desde la ACTIVIDAD que lo necesitó.
 *
 * Una orden puede traer el preventivo del mes y, en el mismo viaje, la fuga
 * que alguien reporto. Clasificar su material por el tipo del encabezado
 * atribuye al preventivo lo que se gasto en la falla —o al reves— y el costo
 * por tipo de mantenimiento deja de ser cierto.
 *
 * Aqui se junta, por actividad, todo el recorrido: lo pedido, lo entregado, lo
 * que sigue pendiente, lo que se mando a comprar, lo que ya llego, lo devuelto
 * y el costo NETO que le queda. Es la misma cadena que recorre el material:
 *
 *   actividad → requisicion → surtido o faltante → compra → recepcion →
 *   inventario → consumo o devolucion
 *
 * Lo que no trae actividad no se adivina: cae en «consumo general de la OT»
 * si asi se pidio, o en «actividad no especificada» si es de antes de que el
 * vale guardara la actividad.
 */
import { prisma } from "./db";
import { tipoDeActividad } from "./fallas";
import { ESTADOS_COMPRA_ABIERTA } from "./compras";

export type MaterialDeActividad = {
  /** Nulo en el consumo general de la orden y en los vales historicos. */
  taskId: string | null;
  titulo: string;
  /** PREVENTIVE | CORRECTIVE | … Nulo cuando no hay actividad que lo diga. */
  tipo: string | null;
  /** Solo para los renglones sin actividad: si fue a proposito o es historico. */
  historico: boolean;
  renglones: Array<{
    descripcion: string;
    unidad: string;
    solicitada: number;
    surtida: number;
    devuelta: number;
    pendiente: number;
    /** Lo que se mando a comprar por lo que falto, y lo que ya llego. */
    comprada: number;
    recibida: number;
    folioVale: string;
    foliosCompra: string[];
  }>;
  solicitado: number;
  entregado: number;
  devuelto: number;
  pendiente: number;
  comprado: number;
  recibido: number;
  /** Lo que de verdad consumio: entregado menos devuelto, a costo. */
  costoNeto: number;
};

export async function materialPorActividad(organizationId: string, workOrderId: string): Promise<MaterialDeActividad[]> {
  const orden = await prisma.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    select: {
      maintenanceType: true,
      tasks: { select: { id: true, title: true, maintenanceType: true }, orderBy: { position: "asc" } },
    },
  });
  if (!orden) return [];

  const [renglones, cargos] = await Promise.all([
    prisma.materialRequestLine.findMany({
      where: { request: { organizationId, workOrderId, estado: { not: "CANCELADA" } } },
      select: {
        id: true, taskId: true, descripcion: true, partId: true,
        cantidadSolicitada: true, cantidadSurtida: true, cantidadDevuelta: true,
        part: { select: { unit: true } },
        request: { select: { folio: true } },
        compras: {
          select: {
            cantidadSolicitada: true, cantidadRecibida: true,
            request: { select: { folio: true, estado: true } },
          },
        },
      },
    }),
    prisma.workOrderPart.findMany({
      where: { workOrderId },
      select: { taskId: true, quantity: true, devuelto: true, unitCost: true, cost: true },
    }),
  ]);

  const grupos = new Map<string, MaterialDeActividad>();
  const clave = (taskId: string | null) => taskId ?? "__general";
  const nuevo = (taskId: string | null, titulo: string, tipo: string | null, historico: boolean): MaterialDeActividad => ({
    taskId, titulo, tipo, historico, renglones: [],
    solicitado: 0, entregado: 0, devuelto: 0, pendiente: 0, comprado: 0, recibido: 0, costoNeto: 0,
  });

  for (const t of orden.tasks) {
    grupos.set(t.id, nuevo(t.id, t.title, tipoDeActividad(t.maintenanceType, orden.maintenanceType), false));
  }

  /**
   * El grupo sin actividad: material de la orden completa, refaccion cargada a
   * mano en la orden, o un vale anterior a que se guardara la actividad. En
   * ninguno de los tres casos se le inventa un tipo.
   */
  const general = () => {
    const previo = grupos.get("__general");
    if (previo) return previo;
    const g = nuevo(null, "Consumo general de la OT / actividad no especificada", null, true);
    grupos.set("__general", g);
    return g;
  };

  for (const r of renglones) {
    const grupo = (r.taskId ? grupos.get(r.taskId) : undefined) ?? general();

    const comprada = r.compras
      .filter((c) => ESTADOS_COMPRA_ABIERTA.includes(c.request.estado) || ["RECIBIDA", "CERRADA"].includes(c.request.estado))
      .reduce((s, c) => s + c.cantidadSolicitada, 0);
    const recibida = r.compras.reduce((s, c) => s + c.cantidadRecibida, 0);
    const pendiente = Math.max(0, r.cantidadSolicitada - r.cantidadSurtida);

    grupo.renglones.push({
      descripcion: r.descripcion,
      unidad: r.part?.unit ?? "pza",
      solicitada: r.cantidadSolicitada,
      surtida: r.cantidadSurtida,
      devuelta: r.cantidadDevuelta,
      pendiente,
      comprada,
      recibida,
      folioVale: r.request.folio,
      foliosCompra: [...new Set(r.compras.map((c) => c.request.folio))],
    });
    grupo.solicitado += r.cantidadSolicitada;
    grupo.entregado += r.cantidadSurtida;
    grupo.devuelto += r.cantidadDevuelta;
    grupo.pendiente += pendiente;
    grupo.comprado += comprada;
    grupo.recibido += recibida;
  }

  // El costo neto sale de los cargos de la orden, que es donde vive el dinero:
  // ahi entran tambien las refacciones cargadas a mano, sin pasar por un vale.
  for (const c of cargos) {
    // Un cargo sin actividad tambien cuenta: es la refaccion que se puso
    // directo en la orden, y antes no aparecia por ningun lado.
    const grupo = (c.taskId ? grupos.get(c.taskId) : undefined) ?? general();
    grupo.costoNeto += c.cost;
  }

  return [...grupos.values()].filter((g) => g.renglones.length > 0 || g.costoNeto > 0);
}

/**
 * Costo de material por TIPO de mantenimiento, atribuido por actividad.
 *
 * El cargo lleva su actividad; si no la trae —refaccion cargada a mano al
 * encabezado, o material anterior a este cambio— cuenta con el tipo de la
 * orden, que es lo unico que se sabe de el. No se reparte nada con reglas
 * inventadas.
 */
export async function costoDeMaterialPorTipo(organizationId: string, desde: Date, hasta: Date) {
  const cargos = await prisma.workOrderPart.findMany({
    where: {
      workOrder: { organizationId, completedAt: { gte: desde, lt: hasta } },
    },
    select: {
      cost: true,
      task: { select: { maintenanceType: true } },
      workOrder: { select: { maintenanceType: true } },
    },
  });

  const porTipo = new Map<string, { costo: number; deLaActividad: number; delEncabezado: number }>();
  for (const c of cargos) {
    const tipo = tipoDeActividad(c.task?.maintenanceType ?? null, c.workOrder.maintenanceType);
    const acc = porTipo.get(tipo) ?? { costo: 0, deLaActividad: 0, delEncabezado: 0 };
    acc.costo += c.cost;
    if (c.task) acc.deLaActividad += c.cost;
    else acc.delEncabezado += c.cost;
    porTipo.set(tipo, acc);
  }
  return [...porTipo.entries()]
    .map(([tipo, v]) => ({ tipo, ...v }))
    .sort((a, b) => b.costo - a.costo);
}
