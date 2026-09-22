import { prisma } from "./db";
import { estaBajoMinimo } from "./almacen-estado";

/**
 * Analisis del almacen a partir de los datos propios.
 *
 * Responde cuatro preguntas que nadie contesta hasta que duelen:
 *
 *   - Que refaccion exigen mis planes y no tengo
 *   - Que minimos estan mal puestos frente al consumo real
 *   - Que se consume sin estar controlado
 *   - Cuanto dinero llevo parado
 *
 * Todo son cuentas sobre el kardex y los planes. Ni una sola estimacion: si un
 * numero de aqui se le muestra a un cliente, tiene que poder rastrearlo hasta
 * un movimiento de almacen.
 */

const DIA = 86_400_000;
/** Ventana para medir consumo. Seis meses suaviza estacionalidad sin quedarse viejo. */
const DIAS_CONSUMO = 180;
/** Medio ano sin moverse ya es senal: en mantenimiento el consumo es lento pero existe. */
const DIAS_SIN_MOVIMIENTO = 180;

export type FaltanteDePlan = {
  partId: string;
  codigo: string;
  nombre: string;
  unidad: string;
  existencia: number;
  requerido: number;
  faltante: number;
  costoDeSurtir: number;
  planes: string[];
  criticidadMaxima: string;
};

export type MinimoSugerido = {
  partId: string;
  codigo: string;
  nombre: string;
  unidad: string;
  minimoActual: number;
  minimoSugerido: number;
  /** SUBIR: se arriesga a quedarse sin. BAJAR: tiene dinero parado de mas. */
  direccion: "SUBIR" | "BAJAR";
  consumoMensual: number;
  diasDeEntrega: number;
  proveedor: string | null;
  existencia: number;
  /** Solo al bajar: lo que se libera de inventario inmovilizado. */
  dineroLiberado: number;
};

export type BajoMinimo = {
  partId: string;
  codigo: string;
  nombre: string;
  unidad: string;
  existencia: number;
  minimo: number;
  faltante: number;
  costoDeReponer: number;
  diasDeEntrega: number;
  proveedor: string | null;
  /** Criticidad maxima de los equipos cuyos planes la piden, si alguno. */
  criticidad: string | null;
};

export type SinControl = {
  partId: string;
  codigo: string;
  nombre: string;
  salidas: number;
  cantidadConsumida: number;
  unidad: string;
};

export type Inmovilizado = {
  partId: string;
  codigo: string;
  nombre: string;
  existencia: number;
  unidad: string;
  valor: number;
  diasSinMovimiento: number | null;
};

export type AnalisisAlmacen = {
  bajoMinimo: BajoMinimo[];
  faltantesDePlan: FaltanteDePlan[];
  minimosSugeridos: MinimoSugerido[];
  sinControl: SinControl[];
  inmovilizado: Inmovilizado[];
  sinProveedor: Array<{ codigo: string; nombre: string }>;
  totales: {
    valorInventario: number;
    valorInmovilizado: number;
    costoDeSurtirFaltantes: number;
    /** Lo que cuesta volver a poner en minimo lo que esta desabastecido. */
    costoDeReponerMinimos: number;
    /** Lo que se libera si se ajustan los minimos inflados al consumo real. */
    dineroLiberable: number;
    refacciones: number;
  };
};

export async function analizarAlmacen(organizationId: string): Promise<AnalisisAlmacen> {
  const ahora = Date.now();
  const desdeConsumo = new Date(ahora - DIAS_CONSUMO * DIA);

  const [refacciones, requeridasPorPlanes, salidas, ultimoMovimiento] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId, active: true },
      select: {
        id: true, code: true, name: true, unit: true, unitCost: true,
        quantityOnHand: true, minQuantity: true, supplierId: true,
        supplier: { select: { name: true, leadTimeDays: true } },
      },
      orderBy: { code: "asc" },
    }),

    // Lo que los planes activos piden por cada ejecucion.
    prisma.planTaskPart.findMany({
      where: { task: { plan: { organizationId, active: true } } },
      select: {
        partId: true, quantity: true,
        task: { select: { plan: { select: { name: true, asset: { select: { criticality: true } } } } } },
      },
    }),

    prisma.stockMovement.findMany({
      where: { organizationId, movementType: "OUT", createdAt: { gte: desdeConsumo } },
      select: { partId: true, quantity: true },
    }),

    prisma.stockMovement.groupBy({
      by: ["partId"],
      where: { organizationId },
      _max: { createdAt: true },
    }),
  ]);

  const consumoPorParte = new Map<string, { cantidad: number; salidas: number }>();
  for (const s of salidas) {
    const previo = consumoPorParte.get(s.partId) ?? { cantidad: 0, salidas: 0 };
    consumoPorParte.set(s.partId, { cantidad: previo.cantidad + s.quantity, salidas: previo.salidas + 1 });
  }

  const requeridoPorParte = new Map<string, { cantidad: number; planes: Set<string>; criticidad: string }>();
  const ordenCriticidad = ["A", "B", "C"];
  for (const r of requeridasPorPlanes) {
    const previo = requeridoPorParte.get(r.partId) ?? { cantidad: 0, planes: new Set<string>(), criticidad: "C" };
    previo.cantidad += r.quantity;
    previo.planes.add(r.task.plan.name);
    const c = r.task.plan.asset?.criticality ?? "C";
    if (ordenCriticidad.indexOf(c) < ordenCriticidad.indexOf(previo.criticidad)) previo.criticidad = c;
    requeridoPorParte.set(r.partId, previo);
  }

  const ultimaFecha = new Map(ultimoMovimiento.map((m) => [m.partId, m._max.createdAt]));

  const bajoMinimo: BajoMinimo[] = [];
  const faltantesDePlan: FaltanteDePlan[] = [];
  const minimosSugeridos: MinimoSugerido[] = [];
  const sinControl: SinControl[] = [];
  const inmovilizado: Inmovilizado[] = [];
  const sinProveedor: Array<{ codigo: string; nombre: string }> = [];

  let valorInventario = 0;

  for (const p of refacciones) {
    valorInventario += p.quantityOnHand * p.unitCost;
    const requeridoAqui = requeridoPorParte.get(p.id);

    // ── Lo que ya esta por debajo de su propio minimo ─────────────────
    if (estaBajoMinimo(p)) {
      const faltante = p.minQuantity - p.quantityOnHand;
      bajoMinimo.push({
        partId: p.id, codigo: p.code, nombre: p.name, unidad: p.unit,
        existencia: p.quantityOnHand,
        minimo: p.minQuantity,
        faltante,
        costoDeReponer: Math.round(faltante * p.unitCost),
        diasDeEntrega: p.supplier?.leadTimeDays ?? 7,
        proveedor: p.supplier?.name ?? null,
        criticidad: requeridoAqui?.criticidad ?? null,
      });
    }

    // ── Lo que los planes piden y no alcanza ──────────────────────────
    const requerido = requeridoPorParte.get(p.id);
    if (requerido && p.quantityOnHand < requerido.cantidad) {
      const faltante = requerido.cantidad - p.quantityOnHand;
      faltantesDePlan.push({
        partId: p.id, codigo: p.code, nombre: p.name, unidad: p.unit,
        existencia: p.quantityOnHand,
        requerido: requerido.cantidad,
        faltante,
        costoDeSurtir: Math.round(faltante * p.unitCost),
        planes: [...requerido.planes],
        criticidadMaxima: requerido.criticidad,
      });
    }

    // ── Punto de reorden contra el minimo capturado ───────────────────
    //
    // Reorden = lo que se consume mientras llega el resurtido, mas un
    // colchon. El colchon es mayor cuando el articulo aparece en planes de
    // equipos criticos: ahi quedarse sin existencia detiene produccion.
    const consumo = consumoPorParte.get(p.id);
    if (consumo && consumo.cantidad > 0) {
      const consumoDiario = consumo.cantidad / DIAS_CONSUMO;
      const diasDeEntrega = p.supplier?.leadTimeDays ?? 7;
      const critico = requerido?.criticidad === "A";

      // Una refaccion de mantenimiento no se almacena por su ritmo de consumo
      // sino por lo que cuesta no tenerla el dia que se necesita. Un rodamiento
      // que sale una vez cada seis meses igual detiene la maquina, y la formula
      // de reorden de materiales de produccion —consumo por dias de entrega—
      // aconsejaria tener uno o ninguno. Por eso el piso es poder atender una
      // intervencion completa, dos si el equipo es criticidad A.
      const porIntervencion = consumo.cantidad / consumo.salidas;
      const piso = Math.ceil(porIntervencion * (critico ? 2 : 1));
      const porEntrega = Math.ceil(consumoDiario * diasDeEntrega * (critico ? 1.8 : 1.3));
      const sugerido = Math.max(1, piso, porEntrega);

      // Se reporta en los dos sentidos. Un minimo corto arriesga el paro; uno
      // inflado es dinero detenido en un anaquel. Las dos cosas cuestan, y
      // ninguna se nota sin comparar contra el consumo real.
      const diferencia = Math.abs(sugerido - p.minQuantity);
      const relevante = diferencia >= Math.max(1, p.minQuantity * 0.4);
      // Bajarle el minimo a algo que hoy esta desabastecido es un mal consejo:
      // primero se repone, despues se discute el nivel.
      const enProblemas = p.quantityOnHand < p.minQuantity;

      if (relevante && sugerido !== p.minQuantity && !(sugerido < p.minQuantity && enProblemas)) {
        const baja = sugerido < p.minQuantity;
        minimosSugeridos.push({
          partId: p.id, codigo: p.code, nombre: p.name, unidad: p.unit,
          minimoActual: p.minQuantity,
          minimoSugerido: sugerido,
          direccion: baja ? "BAJAR" : "SUBIR",
          consumoMensual: Math.round((consumoDiario * 30) * 10) / 10,
          diasDeEntrega,
          proveedor: p.supplier?.name ?? null,
          existencia: p.quantityOnHand,
          // Lo que se libera es el excedente que hoy se mantiene por el minimo
          // inflado, no todo lo que hay en el anaquel.
          dineroLiberado: baja ? Math.round((p.minQuantity - sugerido) * p.unitCost) : 0,
        });
      }

      if (p.minQuantity === 0) {
        sinControl.push({
          partId: p.id, codigo: p.code, nombre: p.name,
          salidas: consumo.salidas,
          cantidadConsumida: Math.round(consumo.cantidad * 10) / 10,
          unidad: p.unit,
        });
      }
    }

    // ── Dinero parado ─────────────────────────────────────────────────
    const ultima = ultimaFecha.get(p.id) ?? null;
    const dias = ultima ? Math.floor((ahora - ultima.getTime()) / DIA) : null;
    if (p.quantityOnHand > 0 && (dias === null || dias >= DIAS_SIN_MOVIMIENTO)) {
      inmovilizado.push({
        partId: p.id, codigo: p.code, nombre: p.name,
        existencia: p.quantityOnHand, unidad: p.unit,
        valor: Math.round(p.quantityOnHand * p.unitCost),
        diasSinMovimiento: dias,
      });
    }

    if (!p.supplierId) sinProveedor.push({ codigo: p.code, nombre: p.name });
  }

  const orden = ["A", "B", "C"];
  faltantesDePlan.sort(
    (a, b) => orden.indexOf(a.criticidadMaxima) - orden.indexOf(b.criticidadMaxima) || b.costoDeSurtir - a.costoDeSurtir,
  );
  // Primero lo que arriesga un paro, despues lo que solo cuesta dinero.
  minimosSugeridos.sort(
    (a, b) =>
      Number(b.direccion === "SUBIR") - Number(a.direccion === "SUBIR") ||
      b.dineroLiberado - a.dineroLiberado ||
      (b.minimoSugerido - b.minimoActual) - (a.minimoSugerido - a.minimoActual),
  );
  inmovilizado.sort((a, b) => b.valor - a.valor);

  const ordenCrit = ["A", "B", "C"];
  bajoMinimo.sort(
    (a, b) =>
      ordenCrit.indexOf(a.criticidad ?? "C") - ordenCrit.indexOf(b.criticidad ?? "C") ||
      b.costoDeReponer - a.costoDeReponer,
  );

  return {
    bajoMinimo,
    faltantesDePlan,
    minimosSugeridos,
    sinControl,
    inmovilizado,
    sinProveedor,
    totales: {
      valorInventario: Math.round(valorInventario),
      valorInmovilizado: inmovilizado.reduce((s, i) => s + i.valor, 0),
      costoDeSurtirFaltantes: faltantesDePlan.reduce((s, f) => s + f.costoDeSurtir, 0),
      costoDeReponerMinimos: bajoMinimo.reduce((s, b) => s + b.costoDeReponer, 0),
      dineroLiberable: minimosSugeridos.reduce((s, m) => s + m.dineroLiberado, 0),
      refacciones: refacciones.length,
    },
  };
}
