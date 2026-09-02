/**
 * La carga y el trabajo del equipo de mantenimiento.
 *
 * El proposito es entender la operacion a traves de las personas, no evaluar a
 * las personas. No es una sutileza: los dos caminos usan los mismos numeros y
 * llegan a productos opuestos. Un tablero que ordena tecnicos por
 * productividad se lee como vigilancia, y el dia que se lee asi la gente
 * empieza a inflar las horas que captura. Ahi muere el dato.
 *
 * Por eso aqui no hay calificaciones ni rankings, y cada cifra se acompana de
 * con cuantos casos se calculo: un porcentaje sacado de dos ordenes no dice
 * nada de nadie.
 */
import { prisma } from "./db";
import { OPEN_STATUSES } from "./constants";
import { MOTIVOS_LIBERACION } from "./backlog";
import { cargaPorDia, jornada } from "./agenda";

export type RangoPersonal = { desde: Date; hasta: Date };

export function rangoPorOmision(dias = 90): RangoPersonal {
  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setDate(hasta.getDate() - dias);
  desde.setHours(0, 0, 0, 0);
  return { desde, hasta };
}

const redondea = (n: number, d = 1) => Number(n.toFixed(d));

export type ResumenPersona = Awaited<ReturnType<typeof cargaDelEquipo>>["personas"][number];

/**
 * Todo lo que se puede decir del trabajo de cada persona con lo que hay
 * capturado, sin inventar nada.
 */
export async function cargaDelEquipo(
  organizationId: string,
  opciones?: { rango?: RangoPersonal; soloUserId?: string | null; diasHorizonte?: number },
) {
  const rango = opciones?.rango ?? rangoPorOmision();
  const horizonte = opciones?.diasHorizonte ?? 15;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const finHorizonte = new Date(hoy);
  finHorizonte.setDate(hoy.getDate() + horizonte);

  const dondeUsuario = opciones?.soloUserId ? { id: opciones.soloUserId } : {};

  const [personas, abiertas, cerradas, labor, actividades, j] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId, active: true,
        role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] },
        ...dondeUsuario,
      },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, color: true, role: true, jobTitle: true,
        horasDisponibles: true, hourlyRate: true,
      },
    }),

    // Lo que traen asignado ahora. No se filtra por fecha: una orden abierta
    // sin fecha tambien es carga, y esconderla seria mentir por omision.
    prisma.workOrder.findMany({
      // Sin filtrar por responsable: lo que no tiene duenio tambien hace falta
      // verlo, y es justo lo que se pierde de vista porque no es de nadie.
      where: { organizationId, status: { in: [...OPEN_STATUSES] } },
      select: {
        id: true, number: true, title: true, estimatedHours: true, dueDate: true,
        maintenanceType: true, priority: true, assignedToId: true,
        asset: { select: { id: true, code: true, name: true, criticality: true } },
        assignedTo: { select: { id: true, name: true, color: true, horasDisponibles: true } },
      },
    }),

    // Lo cerrado en el periodo, para comparar estimado contra real.
    prisma.workOrder.findMany({
      where: {
        organizationId,
        status: { in: ["COMPLETED", "CLOSED"] },
        completedAt: { gte: rango.desde, lte: rango.hasta },
      },
      select: {
        id: true, number: true, estimatedHours: true, maintenanceType: true,
        assignedToId: true, dueDate: true, completedAt: true,
        asset: { select: { id: true, code: true, name: true } },
        labor: { select: { userId: true, hours: true, cost: true } },
      },
    }),

    prisma.workOrderLabor.findMany({
      where: {
        workedAt: { gte: rango.desde, lte: rango.hasta },
        workOrder: { organizationId },
      },
      select: {
        userId: true, hours: true, cost: true, workedAt: true,
        workOrder: { select: { maintenanceType: true, asset: { select: { id: true, code: true, name: true } } } },
      },
    }),

    prisma.workOrderTask.findMany({
      where: {
        workOrder: { organizationId },
        OR: [
          { completedAt: { gte: rango.desde, lte: rango.hasta } },
          { liberadaAt: { gte: rango.desde, lte: rango.hasta } },
        ],
      },
      select: {
        completedById: true, completedAt: true,
        liberadaPorId: true, liberadaAt: true, motivoLiberacion: true,
      },
    }),

    jornada(organizationId, hoy, finHorizonte),
  ]);

  const dias = Array.from({ length: horizonte }, (_, i) => {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() + i);
    return d;
  });
  const carga = cargaPorDia(
    dias,
    abiertas.map((o) => ({
      dueDate: o.dueDate, estimatedHours: o.estimatedHours, status: "OPEN",
      assignedTo: o.assignedTo,
    })),
    j,
  );

  const resultado = personas.map((p) => {
    const suyas = abiertas.filter((o) => o.assignedToId === p.id);
    const vencidas = suyas.filter((o) => o.dueDate && o.dueDate < hoy);
    const capacidad = p.horasDisponibles ?? j.horasJornada;

    // --- Horas aplicadas en el periodo ---
    const suLabor = labor.filter((l) => l.userId === p.id);
    const horasAplicadas = suLabor.reduce((s, l) => s + l.hours, 0);
    const costoMano = suLabor.reduce((s, l) => s + l.cost, 0);

    const porTipo = suLabor.reduce<Record<string, number>>((a, l) => {
      const t = l.workOrder.maintenanceType;
      a[t] = (a[t] ?? 0) + l.hours;
      return a;
    }, {});

    // --- Estimado contra real ---
    //
    // Solo se comparan las ordenes donde esta persona fue la unica que capturo
    // horas Y era la responsable. Si dos personas trabajaron la misma orden,
    // el estimado es del trabajo completo y no se puede repartir sin inventar.
    const comparables = cerradas.filter(
      (o) =>
        o.assignedToId === p.id &&
        o.estimatedHours > 0 &&
        o.labor.length > 0 &&
        o.labor.every((l) => l.userId === p.id),
    );
    const estimadas = comparables.reduce((s, o) => s + o.estimatedHours, 0);
    const reales = comparables.reduce((s, o) => s + o.labor.reduce((x, l) => x + l.hours, 0), 0);

    // --- Puntualidad ---
    const conFecha = cerradas.filter((o) => o.assignedToId === p.id && o.dueDate && o.completedAt);
    const aTiempo = conFecha.filter((o) => o.completedAt! <= o.dueDate!).length;

    // --- Actividades ---
    const completadas = actividades.filter((t) => t.completedById === p.id && t.completedAt).length;
    const liberadas = actividades.filter((t) => t.liberadaPorId === p.id && t.liberadaAt);
    const porMotivo = liberadas.reduce<Record<string, number>>((a, t) => {
      const m = t.motivoLiberacion ?? "OTRO";
      a[m] = (a[m] ?? 0) + 1;
      return a;
    }, {});

    // --- Equipos que atiende ---
    const equipos = new Map<string, { code: string; name: string; horas: number }>();
    for (const l of suLabor) {
      const a = l.workOrder.asset;
      if (!a) continue;
      const prev = equipos.get(a.id);
      if (prev) prev.horas += l.hours;
      else equipos.set(a.id, { code: a.code, name: a.name, horas: l.hours });
    }

    // --- Carga por venir ---
    const proximos = carga.map((c) => {
      const suya = c.personas.find((x) => x.userId === p.id);
      return {
        fecha: c.fecha,
        habil: c.habil,
        horas: suya?.horas ?? 0,
        capacidad: c.habil ? capacidad : 0,
        excedido: (suya?.ocupacion ?? 0) > 1,
      };
    });

    return {
      id: p.id,
      nombre: p.name,
      color: p.color,
      rol: p.role,
      puesto: p.jobTitle,
      capacidadDiaria: capacidad,

      asignado: {
        ordenes: suyas.length,
        horas: redondea(suyas.reduce((s, o) => s + o.estimatedHours, 0)),
        vencidas: vencidas.length,
        horasVencidas: redondea(vencidas.reduce((s, o) => s + o.estimatedHours, 0)),
        criticas: suyas.filter((o) => o.priority === "CRITICAL" || o.asset?.criticality === "A").length,
      },

      aplicado: {
        horas: redondea(horasAplicadas),
        costo: redondea(costoMano, 2),
        porTipo: Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, redondea(v)])),
        /** Cuanto de lo aplicado fue correctivo. Dice si apaga incendios. */
        porcentajeCorrectivo:
          horasAplicadas > 0 ? redondea(((porTipo.CORRECTIVE ?? 0) / horasAplicadas) * 100, 0) : null,
      },

      estimacion: {
        /** Con cuantas ordenes se calculo. Sin esto, el porcentaje enganaria. */
        ordenes: comparables.length,
        estimadas: redondea(estimadas),
        reales: redondea(reales),
        /** Mas de 100 es que toma mas tiempo del estimado. Null si no hay base. */
        desviacion: estimadas > 0 && comparables.length >= 3 ? redondea((reales / estimadas) * 100, 0) : null,
      },

      puntualidad: {
        ordenes: conFecha.length,
        aTiempo,
        porcentaje: conFecha.length >= 3 ? redondea((aTiempo / conFecha.length) * 100, 0) : null,
      },

      actividades: {
        completadas,
        liberadas: liberadas.length,
        porMotivo,
        /** Lo trabado por falta de material no es del tecnico, es del almacen. */
        porFaltaDeMaterial: porMotivo.SIN_REFACCION ?? 0,
      },

      equipos: [...equipos.values()].sort((a, b) => b.horas - a.horas).slice(0, 8)
        .map((e) => ({ ...e, horas: redondea(e.horas) })),

      proximos,
      diasExcedidos: proximos.filter((d) => d.excedido).length,
    };
  });

  // Lo que no tiene responsable: no es de nadie y por eso se pierde de vista.
  const sinAsignar = abiertas.filter((o) => !o.assignedToId);

  return {
    rango,
    jornadaBase: j.horasJornada,
    personas: resultado,
    sinResponsable: {
      ordenes: sinAsignar.length,
      horas: redondea(sinAsignar.reduce((s, o) => s + o.estimatedHours, 0)),
    },
    motivos: MOTIVOS_LIBERACION,
  };
}
