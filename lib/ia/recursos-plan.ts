import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";

/**
 * Qué consume cada actividad de un plan que YA existe.
 *
 * ── Por qué hace falta ──
 *
 * El generador redacta planes completos, con sus refacciones. Pero los planes
 * que entraron por importación o que alguien capturó a mano se quedaron sin
 * ellas, y sin eso la proyección de compras no tiene de qué vivir: medido en
 * producción, nueve de ciento dieciséis actividades tenían consumo cargado.
 *
 * Capturarlas a mano son horas de buscar en el catálogo que nadie va a hacer
 * sin una razón inmediata. Aquí se propone y una persona acepta.
 *
 * ── Lo que NO hace ──
 *
 * No guarda nada. Devuelve una propuesta por actividad y alguien la revisa: un
 * plan mal puesto genera órdenes equivocadas y compras equivocadas durante
 * años, y este es justo el dato que después se convierte en dinero.
 *
 * Tampoco inventa códigos. Solo puede proponer del catálogo del cliente, y lo
 * que no encuentre ahí se descarta al recibir. Un código inventado pasaría a
 * una requisición de compra y nadie lo notaría hasta que llegara la factura.
 *
 * ── Por qué «sin consumo» es una respuesta y no un silencio ──
 *
 * La mayoría de las actividades de un preventivo no gastan material: revisar,
 * medir, limpiar y probar no consumen nada. Si el modelo solo pudiera
 * proponer, «no propuse nada» se confundiría con «no supe», y quien revisa no
 * sabría si el hueco es del plan o de la máquina. Por eso tiene que declarar
 * explícitamente cuáles no llevan material.
 */

const EsquemaRecursos = z.object({
  actividades: z.array(
    z.object({
      numero: z.number().describe("El numero de la actividad, tal como viene en la lista que se le dio."),
      refacciones: z.array(
        z.object({
          codigo: z.string().describe("Codigo EXACTO del catalogo de la empresa. Nunca invente uno que no este en la lista."),
          cantidad: z.number().describe("Cuantas piezas se consumen CADA VEZ que se hace esta actividad, no al ano."),
          porQue: textoIa(140, "Por que esa refaccion en esta actividad, en pocas palabras."),
        }),
      ),
    }),
  ).describe("Solo las actividades que SI consumen material. Las demas van en sinConsumo."),
  sinConsumo: z.array(z.number()).describe(
    "Numeros de las actividades que no gastan material: revisar, medir, inspeccionar, limpiar, probar, apretar. Es una respuesta valida y la mas comun.",
  ),
  sinCatalogo: z.array(
    z.object({
      numero: z.number(),
      queFalta: textoIa(120, "Que refaccion haria falta y no existe en el catalogo de la empresa."),
    }),
  ).describe("Actividades que SI consumen algo, pero ese algo no esta dado de alta. Es lo que hay que capturar antes."),
});

export type PropuestaDeRecursos = z.infer<typeof EsquemaRecursos>;

const SISTEMA = `Eres un planeador de mantenimiento que revisa el plan preventivo de un equipo y dice que material consume cada actividad.

Reglas que no se rompen:
- Solo puede usar refacciones del catalogo que se le entrega, por su codigo exacto. Si lo que hace falta no esta en el catalogo, digalo en sinCatalogo; NO proponga un codigo parecido ni lo invente.
- La cantidad es por EJECUCION de la actividad, no al ano.
- La mayoria de las actividades de un preventivo no consumen material. Revisar, medir, inspeccionar, limpiar, probar y apretar no gastan nada: esas van en sinConsumo. Es la respuesta mas comun y es correcta.
- No proponga material "por si acaso". Si la actividad no lo consume siempre, no lo ponga.
- Cada actividad tiene que aparecer EXACTAMENTE UNA VEZ, en actividades, en sinConsumo o en sinCatalogo.`;

export async function proponerRecursosDePlan(
  org: OrgConIa,
  params: { planId: string; userId?: string | null },
): Promise<
  | { ok: true; propuesta: PropuestaDeRecursos; actividades: Array<{ numero: number; id: string; titulo: string }>; costoUsd: number }
  | { ok: false; motivo: string }
> {
  const veredicto = await puedeUsarIa(org, "PLAN");
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const plan = await prisma.maintenancePlan.findFirst({
    where: { id: params.planId, organizationId: org.id },
    select: {
      id: true, name: true, description: true, maintenanceType: true, intervalDays: true,
      tasks: {
        orderBy: { position: "asc" },
        select: {
          id: true, title: true, description: true, taskType: true, cadaCuanto: true, unidadFrecuencia: true,
          parts: { select: { part: { select: { code: true } } } },
        },
      },
      asignaciones: {
        take: 3,
        select: { asset: { select: { code: true, name: true, manufacturer: true, model: true, category: { select: { name: true } } } } },
      },
    },
  });
  if (!plan) return { ok: false, motivo: "Ese plan no existe en esta empresa." };
  if (!plan.tasks.length) {
    return { ok: false, motivo: "El plan no tiene actividades todavía. Agréguelas primero: sin ellas no hay a qué colgarle el material." };
  }

  // Solo las que NO tienen nada. Volver a proponer sobre lo que alguien ya
  // capturó es invitar a pisar una decisión tomada.
  const pendientes = plan.tasks.filter((t) => t.parts.length === 0);
  if (!pendientes.length) {
    return { ok: false, motivo: "Todas las actividades de este plan ya dicen qué consumen." };
  }

  const refacciones = await prisma.part.findMany({
    where: { organizationId: org.id, active: true },
    select: { code: true, name: true, unit: true, category: true },
    orderBy: { code: "asc" },
  });
  if (!refacciones.length) {
    return { ok: false, motivo: "El catálogo de refacciones está vacío: no hay de dónde proponer. Dé de alta las refacciones primero." };
  }

  const numeradas = pendientes.map((t, i) => ({ numero: i + 1, id: t.id, titulo: t.title }));

  const { datos, costoUsd } = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "PLAN",
    sistema: SISTEMA,
    instruccion: "Diga que refacciones consume cada actividad de este plan, usando unicamente el catalogo de la empresa.",
    contexto: {
      plan: {
        nombre: plan.name,
        descripcion: plan.description,
        tipo: plan.maintenanceType,
        cadaCuantosDias: plan.intervalDays,
      },
      equipos: plan.asignaciones.map((a) =>
        [a.asset.code, a.asset.name, a.asset.manufacturer, a.asset.model, a.asset.category?.name].filter(Boolean).join(" · "),
      ),
      actividades: pendientes.map((t, i) => ({
        numero: i + 1,
        titulo: t.title,
        detalle: t.description,
        tipo: t.taskType,
        frecuencia: t.cadaCuanto ? `cada ${t.cadaCuanto} ${(t.unidadFrecuencia ?? "DIAS").toLowerCase()}` : "la del plan",
      })),
      catalogoDeRefacciones: refacciones.map((p) => `${p.code} · ${p.name} (${p.unit})${p.category ? ` · ${p.category}` : ""}`),
    },
    esquema: EsquemaRecursos,
  });

  return { ok: true, propuesta: datos, actividades: numeradas, costoUsd };
}

/**
 * La propuesta, ya cruzada con el catálogo y con las actividades reales.
 *
 * Aquí se cae lo que el modelo se haya inventado: un código que no existe, una
 * actividad que no estaba en la lista, una cantidad absurda. Es la frontera de
 * escritura, y se recorta en vez de rechazar todo —tirar una propuesta
 * completa por un renglón malo es tirar trabajo ya pagado—.
 */
export function aterrizarPropuesta(
  propuesta: PropuestaDeRecursos,
  actividades: Array<{ numero: number; id: string; titulo: string }>,
  catalogo: Array<{ id: string; code: string; name: string; unit: string }>,
) {
  const porNumero = new Map(actividades.map((a) => [a.numero, a]));
  const porCodigo = new Map(catalogo.map((p) => [p.code.toUpperCase(), p]));
  const inventadas: string[] = [];

  const lineas = (propuesta.actividades ?? []).flatMap((a) => {
    const act = porNumero.get(a.numero);
    if (!act) return [];
    const refs = (a.refacciones ?? []).flatMap((r) => {
      const parte = porCodigo.get((r.codigo ?? "").trim().toUpperCase());
      if (!parte) { if (r.codigo) inventadas.push(r.codigo); return []; }
      // Cantidad sensata: cero no es una propuesta, y un número enorme es un
      // error de unidad (al año en vez de por vez) que nadie revisaría.
      const cantidad = Number(r.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 500) return [];
      return [{ partId: parte.id, code: parte.code, name: parte.name, unit: parte.unit, cantidad, porQue: r.porQue ?? "" }];
    });
    return refs.length ? [{ taskId: act.id, titulo: act.titulo, refacciones: refs }] : [];
  });

  const sinConsumo = (propuesta.sinConsumo ?? [])
    .map((n) => porNumero.get(n))
    .filter((a): a is { numero: number; id: string; titulo: string } => Boolean(a));

  const sinCatalogo = (propuesta.sinCatalogo ?? []).flatMap((x) => {
    const act = porNumero.get(x.numero);
    return act ? [{ taskId: act.id, titulo: act.titulo, queFalta: x.queFalta }] : [];
  });

  return { lineas, sinConsumo, sinCatalogo, inventadas: [...new Set(inventadas)] };
}
