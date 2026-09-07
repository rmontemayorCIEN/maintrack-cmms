import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";

/**
 * Procedimiento y seguridad para una orden correctiva.
 *
 * Una preventiva nace de un plan y trae sus actividades escritas. Una
 * correctiva nace de una falla y nace vacia: el tecnico baja a piso sin pasos,
 * sin saber que llevar y sin notas de bloqueo. Eso es donde se pierde tiempo y
 * donde ocurren los accidentes.
 *
 * Dos anclas para que no invente:
 *
 *  - Las refacciones que sugiera tienen que salir del CATALOGO del cliente,
 *    con su codigo. Una refaccion inventada manda al almacenista a buscar algo
 *    que no existe.
 *  - Se le entregan las reparaciones anteriores del mismo equipo. Lo que ya
 *    funciono ahi vale mas que cualquier procedimiento generico.
 */

const Esquema = z.object({
  pasos: z.array(
    z.object({
      titulo: textoIa(180, "La acción, en imperativo y concreta. «Verificar alineamiento del acoplamiento», no «revisar el equipo»."),
      detalle: textoIa(500, "Como se hace, si no es obvio. Null cuando el título basta.").nullable(),
      tipo: z.enum(["CHECK", "MEASURE", "REPLACE", "TEXT"]).describe(
        "MEASURE cuando hay que anotar un numero; REPLACE cuando se cambia una pieza; TEXT cuando hay que describir lo encontrado; CHECK para lo demas.",
      ),
      unidad: z.string().nullable().describe("Solo en MEASURE: mm/s, °C, bar, A, V."),
      minimo: z.number().nullable().describe("Solo en MEASURE: el limite inferior aceptable."),
      maximo: z.number().nullable().describe("Solo en MEASURE: el limite superior aceptable."),
    }),
  ).describe(
    "Entre tres y doce pasos, en el orden en que se ejecutan. Empiece por asegurar el equipo y termine por probarlo.",
  ),
  seguridad: z.array(textoIa(280, "Un punto de seguridad.")).describe(
    "Maximo seis puntos, de lo que hay que hacer ANTES de tocar el equipo: bloqueo y etiquetado, corte de energia, purga, equipo de proteccion, permisos. Concreto para este equipo.",
  ),
  herramientas: z.array(textoIa(90, "Una herramienta o instrumento.")).describe("Lo que hay que bajar, máximo diez. Incluya instrumentos de medición si algun paso los pide."),
  refaccionesProbables: z.array(
    z.object({
      codigo: z.string().describe("El código EXACTO del catálogo entregado. No invente ninguno."),
      porQue: textoIa(200, "Por que podría hacer falta."),
    }),
  ).describe("Máximo seis, y solo las que de verdad podrian hacer falta."),
  advertencia: textoIa(500, "Lo que puede salir mal en esta reparación en particular. Null si no hay nada que destacar.").nullable(),
});

export type Procedimiento = z.infer<typeof Esquema>;

const SISTEMA = `Eres un jefe de mantenimiento preparando el trabajo de un tecnico que va a atender una falla.

El tecnico sabe hacer su oficio; lo que necesita es que alguien le ordene el trabajo antes de bajar: por donde empezar, que llevar, que medir y contra que, y como asegurar el equipo.

Como trabaja:

1. La seguridad va primero y es especifica de ESTE equipo. "Usar equipo de protección" no sirve; "bloquear el interruptor del tablero y verificar ausencia de tensión antes de abrir la caja de conexiones" si.
2. Los pasos son acciones, en imperativo, en el orden en que se ejecutan. Empiece asegurando el equipo y termine probandolo.
3. Cuando un paso implique anotar un numero, marquelo como medicion y ponga su rango esperado. Un tecnico que mide sin saber contra que solo esta apuntando cifras.
4. Las refacciones SOLO pueden salir del catalogo que se le entrega, con su codigo exacto. Si lo que hace falta no esta en el catalogo, no lo ponga: mencionelo en la advertencia.
5. Si le entregan reparaciones anteriores del mismo equipo, uselas. Lo que ya funciono ahi vale mas que un procedimiento de manual.
6. No invente marcas, modelos, torques ni normas. Si un dato asi hace falta y no lo tiene, digalo como paso: "consultar el torque en la placa o el manual".

Responda en español de Mexico. Concreto y breve: un procedimiento largo no se lee.`;

export async function generarProcedimiento(
  org: OrgConIa,
  params: { workOrderId: string; userId?: string | null; operador?: boolean },
): Promise<{ ok: true; procedimiento: Procedimiento; costoUsd: number } | { ok: false; motivo: string }> {
  const veredicto = await puedeUsarIa(org, "PROCEDIMIENTO", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const orden = await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: org.id },
    select: {
      id: true, number: true, title: true, description: true, maintenanceType: true,
      requiresShutdown: true,
      asset: {
        select: {
          id: true, code: true, name: true, criticality: true,
          manufacturer: true, model: true,
          category: { select: { name: true } },
          location: { select: { name: true } },
        },
      },
      failureCode: { select: { description: true } },
      rootCause: { select: { description: true } },
    },
  });
  if (!orden) return { ok: false, motivo: "Orden de trabajo no encontrada" };
  if (!orden.asset) {
    return { ok: false, motivo: "La orden no tiene activo asignado. Sin saber a que equipo se le hace, el procedimiento sería generico." };
  }

  // Lo que ya se hizo en este mismo equipo. Es lo que separa un procedimiento
  // util de uno de manual.
  const anteriores = await prisma.workOrder.findMany({
    where: {
      organizationId: org.id, assetId: orden.asset.id,
      id: { not: orden.id },
      status: { in: ["COMPLETED", "CLOSED"] },
      resolution: { not: null },
    },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: {
      number: true, title: true, resolution: true,
      failureCode: { select: { description: true } },
      partsUsed: { select: { quantity: true, part: { select: { code: true, name: true } } } },
    },
  });

  // El catalogo del cliente, para que no invente refacciones. Se acota a lo que
  // podria aplicar: la familia del equipo mas lo que ya se le ha puesto.
  const catalogo = await prisma.part.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: { code: "asc" },
    take: 300,
    select: { code: true, name: true, unit: true, quantityOnHand: true },
  });

  const r = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "PROCEDIMIENTO",
    sistema: SISTEMA,
    esquema: Esquema,
    instruccion:
      "Prepare el trabajo para esta falla: como asegurar el equipo, los pasos en orden, que medir y contra que, que herramientas bajar y que refacciones del catalogo podrian hacer falta.",
    contexto: {
      falla: {
        folio: orden.number,
        titulo: orden.title,
        descripcion: orden.description,
        modoDeFalla: orden.failureCode?.description ?? null,
        causaRaizRegistrada: orden.rootCause?.description ?? null,
        requiereParo: orden.requiresShutdown,
      },
      equipo: {
        codigo: orden.asset.code,
        nombre: orden.asset.name,
        familia: orden.asset.category?.name ?? null,
        fabricante: orden.asset.manufacturer,
        modelo: orden.asset.model,
        criticidad: orden.asset.criticality,
        ubicacion: orden.asset.location?.name ?? null,
      },
      reparacionesAnterioresDelMismoEquipo: anteriores.map((a) => ({
        folio: a.number,
        que: a.title,
        modoDeFalla: a.failureCode?.description ?? null,
        comoSeResolvio: a.resolution,
        refaccionesUsadas: a.partsUsed.map((p) => `${p.quantity} × ${p.part.code} ${p.part.name}`),
      })),
      catalogoDeRefacciones: catalogo.map((c) => ({
        codigo: c.code, nombre: c.name, unidad: c.unit, existencia: c.quantityOnHand,
      })),
    },
  });

  return { ok: true, procedimiento: r.datos, costoUsd: r.costoUsd };
}

/**
 * Aplica el procedimiento a la orden.
 *
 * Los pasos se vuelven actividades que el tecnico palomea, no un texto que
 * nadie lee. Se agregan al final de las que ya haya: nunca se borra trabajo
 * capturado.
 */
export async function aplicarProcedimiento(params: {
  organizationId: string;
  workOrderId: string;
  procedimiento: Procedimiento;
}) {
  const orden = await prisma.workOrder.findFirst({
    where: { id: params.workOrderId, organizationId: params.organizationId },
    select: { id: true, status: true, maintenanceType: true, procedure: true, safetyNotes: true, _count: { select: { tasks: true } } },
  });
  if (!orden) throw new Error("Orden de trabajo no encontrada");
  if (["CLOSED", "CANCELLED"].includes(orden.status)) throw new Error("La orden ya esta cerrada");

  const desde = orden._count.tasks;
  const p = params.procedimiento;

  await prisma.$transaction([
    prisma.workOrderTask.createMany({
      data: p.pasos.map((paso, i) => ({
        workOrderId: orden.id,
        position: desde + i,
        title: paso.titulo,
        description: paso.detalle,
        taskType: paso.tipo,
        unit: paso.tipo === "MEASURE" ? paso.unidad : null,
        minValue: paso.tipo === "MEASURE" ? paso.minimo : null,
        maxValue: paso.tipo === "MEASURE" ? paso.maximo : null,
        required: true,
        origen: "MANUAL",
        maintenanceType: orden.maintenanceType,
      })),
    }),
    prisma.workOrder.update({
      where: { id: orden.id },
      data: {
        // Lo ya escrito no se pisa: se agrega debajo.
        procedure: [orden.procedure, p.herramientas.length ? `Herramientas: ${p.herramientas.join(", ")}` : null, p.advertencia]
          .filter(Boolean).join("\n\n") || null,
        safetyNotes: [orden.safetyNotes, p.seguridad.map((s) => `· ${s}`).join("\n")]
          .filter(Boolean).join("\n\n") || null,
      },
    }),
  ]);

  return { pasos: p.pasos.length };
}
