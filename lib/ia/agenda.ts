/**
 * Revisar la semana: que mover, que juntar y que no tocar.
 *
 * Todos los numeros se calculan en TypeScript y se le entregan resueltos al
 * modelo: horas por persona, dias que no caben, coincidencias de activo. El
 * modelo NO suma nada. Lo que aporta es el criterio que no tiene formula: que
 * puede esperar y que no, que conviene juntar en una sola visita, y en que
 * orden conviene atacarlo.
 */
import { z } from "zod";
import { prisma } from "../db";
import { cargaPorDia, esHabil, jornada } from "../agenda";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { OPEN_STATUSES } from "../constants";

const esquema = z.object({
  resumen: textoIa(
    420,
    "Como esta la semana, en dos o tres frases. Directo: si esta bien, dilo; si no cabe, di donde aprieta.",
  ),
  movimientos: z
    .array(
      z.object({
        orden: textoIa(20, "El numero de la orden, exactamente como viene en los datos."),
        aFecha: textoIa(10, "La fecha propuesta en formato AAAA-MM-DD. Solo de los dias laborables disponibles."),
        aResponsable: textoIa(80, "A quien pasarla, si conviene cambiarla de persona. Vacio si se queda con quien esta.").nullable(),
        porQue: textoIa(240, "La razon, concreta y en una frase."),
      }),
    )
    .describe("Lo que conviene mover, de lo mas urgente a lo menos. Vacio si la semana esta bien como esta."),
  agrupaciones: z
    .array(
      z.object({
        activo: textoIa(90, "El codigo del equipo, exactamente como viene en los datos."),
        ordenes: z.array(textoIa(20, "Numero de orden.")),
        porQue: textoIa(240, "Por que conviene hacerlas en una sola visita."),
      }),
    )
    .describe("Trabajos del mismo equipo que conviene juntar. Solo si de verdad se aprovecha la vuelta."),
  noMover: z
    .array(
      z.object({
        orden: textoIa(20, "Numero de orden."),
        porQue: textoIa(200, "Por que esta no se debe recorrer aunque el dia este cargado."),
      }),
    )
    .describe("Lo que NO conviene mover: equipo critico, seguridad, o algo que ya se recorrio antes."),
  advertencia: textoIa(
    360,
    "Algo que el supervisor deberia saber y que no es un movimiento: un patron, un riesgo. Null si no hay nada que destacar.",
  ).nullable(),
});

export type RevisionSemana = z.infer<typeof esquema>;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function revisarSemana(
  org: OrgConIa,
  params: { desde: Date; userId?: string | null; operador?: boolean },
): Promise<{ ok: true; revision: RevisionSemana; costoUsd: number } | { ok: false; motivo: string }> {
  const veredicto = await puedeUsarIa(org, "AGENDA", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const lunes = new Date(params.desde);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  lunes.setHours(0, 0, 0, 0);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  domingo.setHours(23, 59, 59);

  // Dos semanas: la que se revisa y la siguiente, que es a donde se puede mover.
  const finSiguiente = new Date(lunes);
  finSiguiente.setDate(lunes.getDate() + 13);
  finSiguiente.setHours(23, 59, 59);

  const [ordenes, vencidas, j] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        organizationId: org.id,
        status: { in: [...OPEN_STATUSES] },
        dueDate: { gte: lunes, lte: domingo },
      },
      select: {
        number: true, title: true, maintenanceType: true, priority: true,
        estimatedHours: true, dueDate: true, requiresShutdown: true,
        asset: { select: { code: true, name: true, criticality: true } },
        assignedTo: { select: { id: true, name: true, horasDisponibles: true, color: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.workOrder.count({
      where: { organizationId: org.id, status: { in: [...OPEN_STATUSES] }, dueDate: { lt: lunes } },
    }),
    jornada(org.id, lunes, finSiguiente),
  ]);

  if (!ordenes.length) {
    return { ok: false, motivo: "No hay ordenes abiertas en esa semana. No hay nada que revisar." };
  }

  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });
  const carga = cargaPorDia(
    dias,
    ordenes.map((o) => ({
      dueDate: o.dueDate, estimatedHours: o.estimatedHours, status: "OPEN",
      assignedTo: o.assignedTo
        ? { id: o.assignedTo.id, name: o.assignedTo.name, color: o.assignedTo.color, horasDisponibles: o.assignedTo.horasDisponibles }
        : null,
    })),
    j,
  );

  // Dias a los que SI se puede mover: laborables de estas dos semanas, de hoy
  // en adelante. Que el modelo elija de una lista cerrada evita que proponga
  // un domingo o una fecha ya pasada.
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const disponibles: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    if (d >= hoy && esHabil(d, j)) disponibles.push(iso(d));
  }

  // Coincidencias de activo: dos o mas trabajos del mismo equipo en la semana.
  // Se calcula aqui; el modelo solo dice si vale la pena juntarlos.
  const porActivo = new Map<string, typeof ordenes>();
  for (const o of ordenes) {
    if (!o.asset) continue;
    const lista = porActivo.get(o.asset.code) ?? [];
    lista.push(o);
    porActivo.set(o.asset.code, lista);
  }
  const coincidencias = [...porActivo.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([code, lista]) => ({
      activo: code,
      nombre: lista[0].asset!.name,
      ordenes: lista.map((o) => ({
        numero: o.number, titulo: o.title, fecha: o.dueDate ? iso(o.dueDate) : null,
        requiereParo: o.requiresShutdown, responsable: o.assignedTo?.name ?? null,
      })),
    }));

  const contexto = {
    semana: { del: iso(lunes), al: iso(domingo) },
    diasLaborablesDisponibles: disponibles,
    ordenesVencidasDeAntes: vencidas,
    dias: carga.map((c) => ({
      fecha: iso(c.fecha),
      laborable: c.habil,
      festivo: c.festivo,
      horasAsignadas: Number(c.horas.toFixed(1)),
      capacidadTotal: Number(c.capacidad.toFixed(1)),
      noCabe: c.sobrecargado,
      porPersona: c.personas.map((p) => ({
        persona: p.nombre,
        horas: Number(p.horas.toFixed(1)),
        capacidad: p.capacidad,
        ocupacion: p.capacidad > 0 ? Number((p.ocupacion * 100).toFixed(0)) : null,
        ordenes: p.ordenes,
      })),
    })),
    ordenes: ordenes.map((o) => ({
      numero: o.number,
      titulo: o.title,
      tipo: o.maintenanceType,
      prioridad: o.priority,
      horasEstimadas: o.estimatedHours,
      fecha: o.dueDate ? iso(o.dueDate) : null,
      requiereParo: o.requiresShutdown,
      responsable: o.assignedTo?.name ?? null,
      activo: o.asset ? `${o.asset.code} — ${o.asset.name}` : null,
      criticidadDelActivo: o.asset?.criticality ?? null,
    })),
    mismoActivoEnLaSemana: coincidencias,
  };

  const resultado = await analizarConIa({
    organizationId: org.id,
    userId: params.userId ?? null,
    funcion: "AGENDA",
    sistema:
      "Eres un planificador de mantenimiento con anos de piso. Revisas la semana de un equipo y dices que mover.\n\n" +
      "Los numeros ya vienen calculados: horas, capacidades y porcentajes de ocupacion. NO los recalcules ni los pongas en duda.\n\n" +
      "Reglas que no se rompen:\n" +
      "- Solo propones fechas de la lista `diasLaborablesDisponibles`. Ninguna otra.\n" +
      "- Solo mencionas ordenes por su numero exacto y activos por su codigo exacto, tal como vienen en los datos.\n" +
      "- Un activo de criticidad A no se recorre por comodidad. Tampoco lo que involucre seguridad.\n" +
      "- Un preventivo se puede adelantar o recorrer pocos dias; recorrerlo semanas equivale a no hacerlo.\n" +
      "- Si la semana esta bien, dilo y no inventes movimientos. Una lista vacia es una respuesta valida y util.\n" +
      "- No propongas contratar gente ni comprar nada: solo mover lo que ya existe.",
    instruccion:
      "Revisa esta semana. Di como esta, que conviene mover y a donde, que trabajos del mismo equipo conviene juntar en una sola visita, y que no se debe tocar aunque el dia venga cargado.",
    contexto,
    esquema,
    esfuerzo: "medium",
  });

  // El modelo elige de una lista cerrada, pero se verifica: una fecha fuera de
  // los dias laborables disponibles se descarta en vez de proponerle al
  // supervisor que programe en domingo.
  const validas = new Set(disponibles);
  const numeros = new Set(ordenes.map((o) => o.number));
  const revision: RevisionSemana = {
    ...resultado.datos,
    movimientos: resultado.datos.movimientos.filter(
      (m) => validas.has(m.aFecha) && numeros.has(m.orden),
    ),
    agrupaciones: resultado.datos.agrupaciones.filter((a) =>
      a.ordenes.every((n) => numeros.has(n)),
    ),
    noMover: resultado.datos.noMover.filter((n) => numeros.has(n.orden)),
  };

  return { ok: true, revision, costoUsd: resultado.costoUsd };
}
