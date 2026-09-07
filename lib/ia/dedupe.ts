import { z } from "zod";
import { analizarConIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { candidatosDuplicados } from "../dedupe-refacciones";

/**
 * Juicio sobre los candidatos a duplicado.
 *
 * El codigo ya encontro los parecidos y ya descarto los que chocan en medidas.
 * Lo que no puede hacer es distinguir entre dos formas de escribir la misma
 * pieza y dos variantes reales del mismo modelo —un sello 2RS contra uno
 * abierto son piezas distintas aunque el nombre casi coincida—.
 *
 * Nada se fusiona solo. Esto ordena y explica; una persona confirma. La fusion
 * no se puede deshacer y no hay diagnostico que valga ese riesgo sin revision.
 */

const Esquema = z.object({
  grupos: z.array(
    z.object({
      codigos: z.array(z.string()).describe("Los códigos de las refacciones que SI son la misma pieza."),
      sobreviviente: z.string().describe(
        "El codigo que conviene conservar: el mas descriptivo y completo, no el mas corto ni el mas viejo.",
      ),
      nombreSugerido: z.string().describe(
        "Como debería llamarse la refacción consolidada, con su medida y sus caracteristicas relevantes.",
      ),
      porQue: z.string().describe("Por que son la misma pieza, en una línea."),
      confianza: z.enum(["ALTA", "MEDIA", "BAJA"]),
    }),
  ),
  descartados: z.array(
    z.object({
      codigos: z.array(z.string()),
      porQue: z.string().describe("Por que NO son la misma pieza, aunque se parezcan."),
    }),
  ).describe("Los que el sistema junto por parecido pero usted determina que son piezas distintas."),
});

export type JuicioDuplicados = z.infer<typeof Esquema>;

const SISTEMA = `Eres el responsable del catalogo de refacciones de un almacen de mantenimiento.

Le entregan grupos de refacciones que el sistema junto por parecido de texto. Su trabajo es separar dos cosas que se ven igual y no lo son:

  - La MISMA pieza capturada varias veces con distinta redaccion. "Balero 6205", "BALERO 6205 2RS" y "balero 6205-2rs skf" casi siempre son una sola.
  - Piezas DISTINTAS que se llaman parecido. Un balero 6205 abierto y uno 2RS con sello son piezas diferentes; una manguera de 1/2 y una de 3/4 tambien.

Como trabaja:

1. Ante la duda, DESCARTE. Fusionar dos piezas distintas es un daño que nadie nota hasta que el tecnico baja por la refaccion equivocada; dejar dos registros duplicados solo es desorden.
2. Fijese en medidas, capacidades, sellos, materiales y voltajes. Son lo que separa piezas parecidas.
3. La que sobrevive es la mas descriptiva, no la mas corta. Un codigo que dice "6205-2RS SKF" vale mas que uno que dice "BAL".
4. El nombre sugerido debe incluir la medida. "Balero" no sirve; "Balero 6205 2RS" si.
5. Si un grupo trae piezas de dos clases, separelo: ponga en el grupo solo las que si son la misma y explique las otras en descartados.

No invente marcas ni especificaciones que no aparezcan en los nombres.`;

export async function juzgarDuplicados(
  org: OrgConIa,
  params: { userId?: string | null; operador?: boolean },
): Promise<
  | { ok: true; juicio: JuicioDuplicados; candidatos: Awaited<ReturnType<typeof candidatosDuplicados>>; costoUsd: number }
  | { ok: false; motivo: string }
> {
  const veredicto = await puedeUsarIa(org, "DEDUPE", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const candidatos = await candidatosDuplicados(org.id);
  if (!candidatos.length) {
    return { ok: false, motivo: "No se encontraron refacciones parecidas. El catálogo esta limpio." };
  }

  const r = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "DEDUPE",
    sistema: SISTEMA,
    esquema: Esquema,
    instruccion:
      "Revise estos grupos de refacciones parecidas y diga cuales son de verdad la misma pieza y cuales no, aunque se parezcan.",
    contexto: {
      grupos: candidatos.slice(0, 25).map((c) => ({
        refacciones: c.refacciones.map((r) => ({
          codigo: r.code,
          nombre: r.name,
          unidad: r.unit,
          existencia: r.existencia,
          costoUnitario: r.costo,
          movimientosEnKardex: r.movimientos,
        })),
      })),
    },
  });

  return { ok: true, juicio: r.datos, candidatos, costoUsd: r.costoUsd };
}
