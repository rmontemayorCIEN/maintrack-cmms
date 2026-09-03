/**
 * Planes aplicados a equipos.
 *
 * El plan es la plantilla; la asignacion es el compromiso con un equipo
 * concreto y es donde vive su calendario. Diez compresores iguales comparten
 * plan pero cada uno lleva su propia proxima fecha, porque en la realidad no
 * se instalaron el mismo dia ni se les hizo servicio el mismo dia.
 */
import { prisma } from "./db";
import { esHabil, jornada } from "./agenda";

export class ErrorDeAsignacion extends Error {
  constructor(mensaje: string, readonly codigo = 422) {
    super(mensaje);
    this.name = "ErrorDeAsignacion";
  }
}

/**
 * Reparte N equipos a lo largo del intervalo del plan.
 *
 * Es aritmetica y no IA a proposito: repartir diez compresores en treinta dias
 * habiles tiene una respuesta correcta, no una opinion. Lo que si es criterio
 * —y por eso va en el orden— es cual va primero: el mas critico y el que lleva
 * mas tiempo sin servicio.
 *
 * Parar los diez el mismo martes es justo lo que un jefe de mantenimiento
 * quiere poder evitar.
 */
export function escalonar(
  equipos: { assetId: string; criticidad: string; ultimoServicio: Date | null }[],
  desde: Date,
  intervaloDias: number,
  esDiaHabil: (d: Date) => boolean,
): { assetId: string; fecha: Date }[] {
  const orden = { A: 0, B: 1, C: 2 } as Record<string, number>;
  const ordenados = [...equipos].sort((a, b) => {
    const c = (orden[a.criticidad] ?? 3) - (orden[b.criticidad] ?? 3);
    if (c !== 0) return c;
    // Sin servicio registrado va primero: es el que mas incertidumbre tiene.
    const ta = a.ultimoServicio?.getTime() ?? 0;
    const tb = b.ultimoServicio?.getTime() ?? 0;
    return ta - tb;
  });

  // El reparto no usa TODO el intervalo: deja margen para que el ultimo no
  // caiga justo el dia en que el primero vuelve a vencer.
  const ventana = Math.max(1, Math.floor(intervaloDias * 0.8));
  const paso = ordenados.length > 1 ? ventana / (ordenados.length - 1) : 0;

  return ordenados.map((e, i) => {
    const d = new Date(desde);
    d.setDate(desde.getDate() + Math.round(paso * i));
    d.setHours(0, 0, 0, 0);
    // Empujar al siguiente habil, con tope por si no hay ninguno configurado.
    for (let k = 0; k < 15 && !esDiaHabil(d); k++) d.setDate(d.getDate() + 1);
    return { assetId: e.assetId, fecha: d };
  });
}

/** Asigna un plan a varios equipos, cada uno con su propia fecha de arranque. */
export async function asignarPlan(params: {
  organizationId: string;
  planId: string;
  equipos: { assetId: string; desde?: Date | null; meterId?: string | null }[];
  escalonarAuto?: boolean;
  userId?: string | null;
}) {
  const plan = await prisma.maintenancePlan.findFirst({
    where: { id: params.planId, organizationId: params.organizationId },
    select: { id: true, intervalDays: true, triggerType: true, intervalMeter: true },
  });
  if (!plan) throw new ErrorDeAsignacion("Plan no encontrado", 404);
  if (!params.equipos.length) throw new ErrorDeAsignacion("Elija al menos un equipo.");

  const ids = params.equipos.map((e) => e.assetId);
  const activos = await prisma.asset.findMany({
    where: { id: { in: ids }, organizationId: params.organizationId },
    select: { id: true, code: true, criticality: true, categoryId: true },
  });
  if (activos.length !== new Set(ids).size) {
    throw new ErrorDeAsignacion("Alguno de los equipos no existe en su catalogo.", 404);
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // Fechas escalonadas solo si se pidieron Y el plan es por calendario: en uno
  // por medidor la fecha la manda la lectura, no el reparto.
  let calendario = new Map<string, Date>();
  if (params.escalonarAuto && plan.triggerType === "CALENDAR" && plan.intervalDays) {
    const hasta = new Date(hoy);
    hasta.setDate(hoy.getDate() + plan.intervalDays + 15);
    const j = await jornada(params.organizationId, hoy, hasta);
    const previas = await prisma.planAsset.findMany({
      where: { organizationId: params.organizationId, assetId: { in: ids } },
      select: { assetId: true, lastCompletedAt: true },
    });
    const ultimo = new Map(previas.map((p) => [p.assetId, p.lastCompletedAt]));
    calendario = new Map(
      escalonar(
        activos.map((a) => ({
          assetId: a.id,
          criticidad: a.criticality,
          ultimoServicio: ultimo.get(a.id) ?? null,
        })),
        hoy,
        plan.intervalDays,
        (d) => esHabil(d, j),
      ).map((x) => [x.assetId, x.fecha]),
    );
  }

  // En un plan por medidor la fecha la manda la lectura, no el reparto. Poner
  // una fecha inventada haria que la pantalla muestre un compromiso que el
  // programador no va a cumplir.
  const porMedidor = plan.triggerType === "METER";

  // Los medidores de cada equipo, para poder ligarlos sin que el usuario
  // tenga que saber ids.
  const medidores = porMedidor
    ? await prisma.meter.findMany({
        where: { organizationId: params.organizationId, assetId: { in: ids } },
        select: { id: true, assetId: true, name: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const medidorDe = new Map<string, string>();
  for (const m of medidores) if (!medidorDe.has(m.assetId)) medidorDe.set(m.assetId, m.id);

  const creadas: string[] = [];
  const yaEstaban: string[] = [];
  /** Equipos que quedaron sin medidor en un plan que lo necesita. */
  const sinMedidor: string[] = [];
  for (const e of params.equipos) {
    const existente = await prisma.planAsset.findUnique({
      where: { planId_assetId: { planId: plan.id, assetId: e.assetId } },
      select: { id: true },
    });
    const codigo = activos.find((a) => a.id === e.assetId)?.code ?? e.assetId;
    if (existente) { yaEstaban.push(codigo); continue; }

    const meterId = e.meterId ?? medidorDe.get(e.assetId) ?? null;
    if (porMedidor && !meterId) sinMedidor.push(codigo);

    await prisma.planAsset.create({
      data: {
        organizationId: params.organizationId,
        planId: plan.id,
        assetId: e.assetId,
        meterId,
        // Sin fecha en los planes por medidor: la calcula el programador a
        // partir de la lectura del equipo.
        nextDueDate: porMedidor ? null : (e.desde ?? calendario.get(e.assetId) ?? hoy),
        createdById: params.userId ?? null,
      },
    });
    creadas.push(codigo);
  }

  // El plan aprende su TIPO de los equipos a los que se aplica.
  //
  // Se deduce en vez de preguntarse: si el plan se aplico a compresores, es un
  // plan de compresores, y pedirle al usuario que lo capture aparte solo abre
  // la puerta a que quede mal. Con eso el sistema puede avisar despues cuando
  // entre un compresor nuevo que se quedo sin este plan.
  //
  // Si se mezclan tipos no se asume ninguno: un plan que cubre compresores y
  // bombas no "pertenece" a ninguno de los dos.
  const todas = await prisma.planAsset.findMany({
    where: { planId: plan.id },
    select: { asset: { select: { categoryId: true } } },
  });
  const tipos = new Set(todas.map((a) => a.asset.categoryId).filter(Boolean));
  await prisma.maintenancePlan.update({
    where: { id: plan.id },
    data: { categoryId: tipos.size === 1 ? [...tipos][0]! : null },
  });

  return { creadas, yaEstaban, sinMedidor };
}

export async function quitarAsignacion(organizationId: string, id: string) {
  const a = await prisma.planAsset.findFirst({
    where: { id, organizationId },
    select: { id: true, planId: true },
  });
  if (!a) throw new ErrorDeAsignacion("Asignacion no encontrada", 404);
  await prisma.planAsset.delete({ where: { id: a.id } });

  // El tipo se recalcula: quitar el equipo que desentonaba puede dejar al plan
  // perteneciendo claramente a un tipo otra vez.
  const quedan = await prisma.planAsset.findMany({
    where: { planId: a.planId },
    select: { asset: { select: { categoryId: true } } },
  });
  const tipos = new Set(quedan.map((x) => x.asset.categoryId).filter(Boolean));
  await prisma.maintenancePlan.update({
    where: { id: a.planId },
    data: { categoryId: tipos.size === 1 ? [...tipos][0]! : null },
  });
}
