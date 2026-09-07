/**
 * Revisar al equipo de mantenimiento.
 *
 * El proposito es entender la operacion a traves de las personas, y eso define
 * el prompt tanto como el esquema: aqui no se califica a nadie ni se ordena a
 * la gente por un numero. Sumar horas es aritmetica y ya viene resuelta; lo
 * que aporta el modelo es distinguir entre explicaciones que el mismo numero
 * admite.
 *
 * "Miguel se tarda 40% mas de lo estimado en eléctrico" puede ser que las
 * estimaciones esten mal hechas, que le toquen siempre los equipos peores, o
 * que le falte una herramienta. Elegir entre esas lecturas no es una formula.
 */
import { z } from "zod";
import { prisma } from "../db";
import { cargaDelEquipo, rangoPorOmision } from "../personal";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";

const esquema = z.object({
  resumen: textoIa(420, "Como esta el equipo en conjunto, en dos o tres frases. Si esta bien, dilo."),
  hallazgos: z
    .array(
      z.object({
        tema: z.enum([
          "CARGA_DESBALANCEADA",
          "CONOCIMIENTO_CONCENTRADO",
          "ESTIMACIONES_FUERA",
          "APAGANDO_INCENDIOS",
          "TRABA_EXTERNA",
          "OTRO",
        ]),
        titulo: textoIa(110, "El hallazgo en una línea."),
        detalle: textoIa(320, "Que dato lo sostiene y por que importa para la operación."),
        personas: z.array(textoIa(80, "Nombre exacto, como viene en los datos.")),
        /**
         * Lo que hay que hacer. Va aparte del hallazgo porque un diagnostico
         * sin siguiente paso no le sirve a nadie que tenga que operar manana.
         */
        queHacer: textoIa(240, "La acción concreta que resuelve o acota esto."),
      }),
    )
    .describe("De lo mas importante a lo menos. Vacío si no hay nada que senalar."),
  reconocer: textoIa(
    280,
    "Algo que este saliendo bien y valga la pena decir en voz alta. Null si no hay nada claro.",
  ).nullable(),
});

export type RevisionEquipo = z.infer<typeof esquema>;

export async function revisarEquipo(
  org: OrgConIa,
  params: { userId?: string | null; operador?: boolean; dias?: number },
): Promise<{ ok: true; revision: RevisionEquipo; costoUsd: number } | { ok: false; motivo: string }> {
  const veredicto = await puedeUsarIa(org, "EQUIPO", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const datos = await cargaDelEquipo(org.id, { rango: rangoPorOmision(params.dias ?? 90) });

  if (datos.personas.length < 2) {
    return {
      ok: false,
      motivo: "Hace falta mas de una persona en el equipo para que un análisis de reparto tenga sentido.",
    };
  }
  const conMovimiento = datos.personas.filter(
    (p) => p.aplicado.horas > 0 || p.asignado.ordenes > 0,
  );
  if (conMovimiento.length === 0) {
    return {
      ok: false,
      motivo: "No hay horas capturadas ni trabajo asignado en el periodo. Sin eso no hay nada que analizar.",
    };
  }

  const contexto = {
    periodo: { del: datos.rango.desde.toISOString().slice(0, 10), al: datos.rango.hasta.toISOString().slice(0, 10) },
    jornadaBase: datos.jornadaBase,
    sinResponsable: datos.sinResponsable,
    comoLeerlo: {
      desviacion: "100 significa que el trabajo tomo exactamente lo estimado. 150 es que tomo la mitad mas.",
      base: "Cada indicador dice con cuantas ordenes se calculo. Con menos de tres viene en null a proposito: un porcentaje sacado de dos ordenes no dice nada de nadie.",
      liberadas: "Actividades que la persona no pudo hacer y devolvio al backlog con motivo. SIN_REFACCION no es una traba suya, es del almacén.",
    },
    equipo: datos.personas.map((p) => ({
      nombre: p.nombre,
      rol: p.rol,
      puesto: p.puesto,
      capacidadDiaria: p.capacidadDiaria,
      asignado: p.asignado,
      aplicado: p.aplicado,
      estimacion: p.estimacion,
      puntualidad: p.puntualidad,
      actividades: p.actividades,
      equiposQueAtiende: p.equipos,
      diasSaturadosProximos: p.diasExcedidos,
    })),
  };

  const resultado = await analizarConIa({
    organizationId: org.id,
    userId: params.userId ?? null,
    funcion: "EQUIPO",
    sistema:
      "Eres un jefe de mantenimiento con anos de piso, revisando como esta trabajando tu equipo.\n\n" +
      "El proposito es entender la OPERACION a traves de las personas. No estas evaluando personas.\n\n" +
      "Reglas que no se rompen:\n" +
      "- NO califiques, NO ordenes a la gente por un numero, NO uses palabras como productivo, eficiente o rendimiento referidas a una persona.\n" +
      "- Los numeros ya vienen calculados. No los recalcules ni los pongas en duda.\n" +
      "- Un indicador en null significa que no hay base suficiente. No opines sobre el.\n" +
      "- Antes de atribuirle algo a una persona, agota las explicaciones de la operacion: estimaciones mal hechas, equipos en mal estado, falta de refacciones, trabajo mal repartido. La mayoria de las veces la causa esta ahi.\n" +
      "- Lo trabado por falta de material NUNCA es del tecnico: es del almacen o de compras. Dilo asi.\n" +
      "- Menciona a las personas por su nombre exacto, y solo a las que vengan en los datos.\n" +
      "- Si el equipo esta bien, dilo y no inventes hallazgos. Una lista vacia es respuesta valida.\n" +
      "- Cada hallazgo trae que hacer. Un diagnóstico sin siguiente paso no le sirve a nadie que tenga que operar mañana.",
    instruccion:
      "Revisa como esta trabajando este equipo: como esta repartida la carga, si el conocimiento esta concentrado en pocas personas, si las estimaciones estan sirviendo, quien esta apagando incendios, y que trabas no son de la gente sino del almacen o de compras.",
    contexto,
    esquema,
    esfuerzo: "medium",
  });

  // Solo personas que existen: un nombre inventado en un analisis de personal
  // es mucho peor que un dato faltante.
  const nombres = new Set(datos.personas.map((p) => p.nombre));
  const revision: RevisionEquipo = {
    ...resultado.datos,
    hallazgos: resultado.datos.hallazgos.map((h) => ({
      ...h,
      personas: h.personas.filter((n) => nombres.has(n)),
    })),
  };

  return { ok: true, revision, costoUsd: resultado.costoUsd };
}
