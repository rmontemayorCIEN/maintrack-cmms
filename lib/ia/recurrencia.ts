import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { expedienteDeFallas } from "../recurrencia";

/**
 * Analisis de recurrencia de fallas de un equipo.
 *
 * Es la promesa clasica de un CMMS que casi ningun sistema cumple: no
 * registrar las fallas, sino explicarlas. El codigo ya sabe contar —fallo
 * cinco veces, cada 32 dias, costo tanto—. Lo que no puede es leer cinco
 * resoluciones escritas por tres tecnicos distintos y notar que todas apuntan
 * al mismo origen aunque ninguna lo nombre.
 *
 * Ninguna cifra la calcula el modelo: todas llegan resueltas y su trabajo es
 * unicamente interpretar el texto.
 */

const Esquema = z.object({
  patron: z.string().describe(
    "Que tienen en comun las fallas. Si de verdad no comparten nada, digalo: no todo equipo con varias fallas tiene un patron.",
  ),
  causaProbable: z.string().describe(
    "El origen mas probable de esas fallas, en lenguaje de mantenimiento. Si la evidencia no alcanza para señalar uno, digalo derecho.",
  ),
  tratandoElSintoma: z.boolean().describe(
    "True cuando las intervenciones atacan la consecuencia y no el origen: cambiar la misma pieza una y otra vez sin corregir lo que la destruye.",
  ),
  porQue: z.string().describe(
    "En que se basa. Cite los folios concretos que sostienen la conclusion. Sin folios no es un analisis, es una opinion.",
  ),
  acciones: z.array(z.string()).describe(
    "Que hacer, en orden, maximo cuatro. Concreto y ejecutable por un tecnico: verificar alineamiento, medir vibracion en tal punto, revisar la puesta a tierra. No 'dar mantenimiento'.",
  ),
  faltaCapturar: z.string().nullable().describe(
    "Que dato hubiera cambiado el analisis y no esta: causas raiz sin llenar, resoluciones vacias, lecturas que nadie tomo. Null si el expediente alcanza.",
  ),
  confianza: z.enum(["ALTA", "MEDIA", "BAJA"]).describe(
    "BAJA cuando las resoluciones estan vacias o son de una linea. Es preferible decir que no alcanza a inventar un diagnostico.",
  ),
});

export type AnalisisRecurrencia = z.infer<typeof Esquema>;

const SISTEMA = `Eres un ingeniero de confiabilidad revisando el historial de fallas de un equipo.

Le entregan las cifras YA CALCULADAS —cuantas fallas, cada cuanto, cuanto costo, que refacciones se consumieron— y el texto de cada orden: que se reporto y que se hizo. Su trabajo es leer ese texto y explicar el patron.

Como trabaja:

1. NO recalcule ni corrija las cifras que le dan. Su aporte es lo que el texto dice y los numeros no.
2. Busque el hilo comun entre las resoluciones, aunque cada tecnico lo haya escrito distinto. "Se cambio el balero", "ruido en la chumacera", "vibracion alta" pueden ser el mismo problema descrito por tres personas.
3. Distinga sintoma de causa. Cambiar el mismo balero cuatro veces en un año no es mala suerte: algo lo esta destruyendo, y casi siempre es alineamiento, lubricacion, sobrecarga o montaje.
4. Cite folios. Una conclusion sin folios que la sostengan no sirve para convencer a nadie.
5. Si las resoluciones estan vacias o dicen "listo" y nada mas, la confianza es BAJA y hay que decirlo. Es preferible admitir que el expediente no alcanza a inventar un diagnostico que despues mande a alguien a desarmar un equipo sano.
6. Las acciones son para un tecnico, no para un manual: que medir, donde, y contra que.

Responda en español de Mexico, directo. No invente marcas, modelos ni normas.`;

export async function analizarRecurrencia(
  org: OrgConIa,
  params: { assetId: string; dias?: number; userId?: string | null; operador?: boolean },
): Promise<
  | { ok: true; analisis: AnalisisRecurrencia; costoUsd: number }
  | { ok: false; motivo: string }
> {
  const veredicto = await puedeUsarIa(org, "RECURRENCIA", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const exp = await expedienteDeFallas(org.id, params.assetId, params.dias ?? 365);
  if (!exp) return { ok: false, motivo: "Activo no encontrado" };
  if (exp.fallas < 3) {
    return {
      ok: false,
      motivo: `Con ${exp.fallas} ${exp.fallas === 1 ? "falla" : "fallas"} en el periodo no hay patron que analizar. El analisis de recurrencia necesita al menos tres.`,
    };
  }

  const r = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "RECURRENCIA",
    sistema: SISTEMA,
    esquema: Esquema,
    instruccion:
      "Lea el historial de fallas de este equipo y explique el patron: que las une, cual es la causa probable, y si se esta tratando el sintoma en vez del origen.",
    contexto: {
      equipo: {
        codigo: exp.activo.code,
        nombre: exp.activo.name,
        categoria: exp.activo.category?.name ?? null,
        criticidad: exp.activo.criticality,
        fabricante: exp.activo.manufacturer,
        modelo: exp.activo.model,
        enOperacionDesde: exp.activo.commissionedAt?.toISOString().slice(0, 10) ?? null,
        ubicacion: [exp.activo.location?.name, exp.activo.site?.name].filter(Boolean).join(" — ") || null,
      },
      cifras: {
        periodoDias: exp.periodoDias,
        fallas: exp.fallas,
        diasEntreFallas: exp.diasEntreFallas,
        intervalosEnDias: exp.intervalos,
        tendencia: exp.tendencia,
        costoTotal: exp.costoTotal,
        costoAnualizado: exp.costoAnualizado,
        porcentajeDelValorDeReposicion: exp.porcentajeDeReposicion,
        horasDeParo: exp.paroHoras,
        modosDeFalla: exp.modosDeFalla,
        causasRaiz: exp.causasRaiz,
        ordenesSinCausaRaiz: exp.sinCausaRaiz,
        refaccionesMasUsadas: exp.refaccionesMasUsadas,
      },
      historial: exp.ordenes,
    },
  });

  await prisma.asset.update({
    where: { id: params.assetId },
    data: { iaRecurrencia: JSON.stringify(r.datos), iaRecurrenciaEl: new Date() },
  });

  return { ok: true, analisis: r.datos, costoUsd: r.costoUsd };
}
