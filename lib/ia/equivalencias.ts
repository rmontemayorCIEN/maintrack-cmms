/**
 * Propuestas de equivalencia entre refacciones.
 *
 * La IA NO inventa referencias cruzadas. Una tabla de equivalencias de baleros
 * es dato de ingenieria y el modelo la recuerda a medias; aqui el error se
 * paga caro, porque montar la pieza equivocada rompe el equipo o lastima a
 * alguien.
 *
 * Lo que si hace bien es leer el catalogo del cliente y notar que "Balero 6205
 * SKF" y "Rodamiento 6205 NSK" son la misma pieza con otra marca. Por eso:
 *
 *  1. Los pares candidatos se calculan en TypeScript, exigiendo que compartan
 *     la designacion numerica. Un 6205 y un 6206 nunca llegan juntos al modelo.
 *  2. El modelo solo juzga pares que ya existen en el catalogo del cliente.
 *  3. Nada se escribe. Todo pasa por la aprobacion del usuario, una por una.
 */
import { z } from "zod";
import { prisma } from "../db";
import { normalizar, parecido } from "../dedupe-refacciones";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";

const esquema = z.object({
  resumen: textoIa(360, "Que se encontro, en dos frases. Si no hay nada claro, dilo."),
  propuestas: z
    .array(
      z.object({
        codigoA: textoIa(40, "Codigo de la primera refaccion, exacto como viene en los datos."),
        codigoB: textoIa(40, "Codigo de la segunda, exacto como viene en los datos."),
        tipo: z.enum(["EQUIVALENTE", "SUSTITUTO", "NO_EQUIVALEN"]),
        porQue: textoIa(240, "La razon, concreta. Que dato del catalogo la sostiene."),
        salvedad: textoIa(200, "La condicion para poder usarla, si el tipo es SUSTITUTO. Null si no aplica.").nullable(),
        confianza: z.enum(["ALTA", "MEDIA", "BAJA"]),
      }),
    )
    .describe("Un veredicto por cada par que se te dio. No agregues pares que no vengan en la lista."),
});

export type PropuestaEquivalencia = z.infer<typeof esquema>["propuestas"][number];

/** Las medidas y designaciones de un texto: 6205, 52, m8. */
const designaciones = (t: string) =>
  new Set(normalizar(t).split(" ").filter((p) => /\d/.test(p) && p.length >= 2));

/**
 * Pares que vale la pena preguntar.
 *
 * La regla dura: tienen que compartir designacion numerica. Es lo que separa
 * "6205 SKF y 6205 NSK" —la misma pieza— de "6205 y 6206", que son baleros
 * distintos y confundirlos destruye una flecha.
 */
export function paresCandidatos(
  refacciones: { id: string; code: string; name: string; category: string | null }[],
  yaRelacionadas: Set<string>,
  tope = 40,
) {
  const conDesignacion = refacciones.map((r) => ({
    ...r,
    designaciones: designaciones(`${r.code} ${r.name}`),
  }));

  const pares: { a: typeof conDesignacion[number]; b: typeof conDesignacion[number]; puntaje: number; comparten: string[] }[] = [];

  for (let i = 0; i < conDesignacion.length; i++) {
    for (let j = i + 1; j < conDesignacion.length; j++) {
      const a = conDesignacion[i];
      const b = conDesignacion[j];
      const clave = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (yaRelacionadas.has(clave)) continue;

      const comparten = [...a.designaciones].filter((d) => b.designaciones.has(d));
      if (comparten.length === 0) continue;

      // Comparten designacion pero ademas deben parecerse: dos piezas
      // distintas pueden traer el mismo numero por casualidad.
      const puntaje = Math.max(parecido(a.name, b.name), parecido(a.code, b.code));
      if (puntaje < 0.35) continue;

      pares.push({ a, b, puntaje, comparten });
    }
  }

  return pares.sort((x, y) => y.puntaje - x.puntaje).slice(0, tope);
}

export async function proponerEquivalencias(
  org: OrgConIa,
  params: { userId?: string | null; operador?: boolean },
): Promise<
  | { ok: true; resumen: string; propuestas: (PropuestaEquivalencia & { partAId: string; partBId: string })[]; costoUsd: number }
  | { ok: false; motivo: string }
> {
  const veredicto = await puedeUsarIa(org, "EQUIVALENCIAS", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const [refacciones, existentes] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId: org.id, active: true },
      select: { id: true, code: true, name: true, category: true, unit: true },
      orderBy: { code: "asc" },
    }),
    prisma.equivalenciaRefaccion.findMany({
      where: { organizationId: org.id },
      select: { partAId: true, partBId: true },
    }),
  ]);

  if (refacciones.length < 2) {
    return { ok: false, motivo: "Hacen falta al menos dos refacciones en el catalogo." };
  }

  const yaRelacionadas = new Set(existentes.map((e) => `${e.partAId}|${e.partBId}`));
  const pares = paresCandidatos(refacciones, yaRelacionadas);

  if (pares.length === 0) {
    return {
      ok: false,
      motivo:
        "No hay pares que compartan designacion en el catalogo. Sin ese dato en comun no hay forma seria de proponer una equivalencia.",
    };
  }

  const porCodigo = new Map(refacciones.map((r) => [r.code, r]));

  const resultado = await analizarConIa({
    organizationId: org.id,
    userId: params.userId ?? null,
    funcion: "EQUIVALENCIAS",
    sistema:
      "Eres un almacenista de mantenimiento con anos de oficio. Te dan pares de refacciones del catalogo de una empresa y dices si se pueden usar una por otra.\n\n" +
      "Reglas que no se rompen:\n" +
      "- NO inventes referencias cruzadas de memoria. Si el catalogo no da elementos suficientes, el veredicto es NO_EQUIVALEN con confianza BAJA.\n" +
      "- Una medida distinta NUNCA es equivalente. Un balero 6205 y uno 6206 son piezas distintas; confundirlos destruye la flecha.\n" +
      "- Solo juzgas los pares que se te dan. No agregues pares nuevos ni menciones refacciones fuera de la lista.\n" +
      "- EQUIVALENTE es la misma pieza con otra marca: misma designacion, mismas medidas, intercambiable sin condiciones.\n" +
      "- SUSTITUTO sirve pero con condicion. La salvedad es obligatoria ahi: sin ella alguien monta la pieza creyendo que hizo bien.\n" +
      "- Si los dos renglones parecen ser LA MISMA refaccion capturada dos veces —mismo codigo de fabricante, misma marca—, eso no es una equivalencia sino un duplicado: contestalo como NO_EQUIVALEN y dilo en el porQue.\n" +
      "- Confianza ALTA solo cuando el catalogo lo sostiene solo. Ante la duda, BAJA.",
    instruccion:
      "Revisa estos pares del catalogo y di, para cada uno, si son la misma pieza de otra marca, si uno sirve como sustituto del otro, o si no equivalen.",
    contexto: {
      nota: "Todos los pares ya comparten al menos una designacion numerica; eso se verifico antes de llegar aqui.",
      pares: pares.map((p) => ({
        a: { codigo: p.a.code, nombre: p.a.name, familia: p.a.category },
        b: { codigo: p.b.code, nombre: p.b.name, familia: p.b.category },
        designacionesEnComun: p.comparten,
      })),
    },
    esquema,
    esfuerzo: "medium",
  });

  // Solo lo que el modelo pudo haber visto, y solo lo que afirma algo. Un
  // codigo que no esta en el catalogo se descarta en silencio.
  const propuestas = resultado.datos.propuestas
    .filter((p) => p.tipo !== "NO_EQUIVALEN")
    .map((p) => {
      const a = porCodigo.get(p.codigoA);
      const b = porCodigo.get(p.codigoB);
      if (!a || !b || a.id === b.id) return null;
      return { ...p, partAId: a.id, partBId: b.id };
    })
    .filter((p): p is PropuestaEquivalencia & { partAId: string; partBId: string } => p !== null);

  return { ok: true, resumen: resultado.datos.resumen, propuestas, costoUsd: resultado.costoUsd };
}
