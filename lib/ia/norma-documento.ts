import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { leerArchivo } from "../almacenamiento";

/**
 * Lee el documento de una norma y propone lo que exige, CITANDO.
 *
 * ── Por que esta funcion existe asi y no de otra forma
 *
 * La tentacion era pedirle al modelo «dime que exige la NOM-020-STPS». No se
 * hizo, y es la decision mas importante de este archivo: el modelo no tiene
 * conocimiento confiable ni actualizado de las normas mexicanas, y contesta
 * con la misma seguridad cuando acierta que cuando inventa un numeral, una
 * periodicidad o un requisito completo.
 *
 * Aqui eso no seria un error cosmetico. El cliente arma con esto el expediente
 * que le enseña a un inspector: una obligacion inventada lo deja preparandose
 * para algo que la norma no pide, y sin lo que si pide.
 *
 * Asi que el modelo NO es la fuente. Lee el documento que el cliente subio
 * —su publicacion oficial, su guia— y saca de AHI las obligaciones. Cada una
 * tiene que venir con la cita textual del renglon que la sustenta. Si no puede
 * citar, no la propone.
 *
 * ── Las anclas
 *
 *  - Cita textual obligatoria por obligacion. Es lo que hace verificable la
 *    propuesta: quien revisa compara contra el documento sin leerlo entero.
 *  - Nada de «la norma tambien suele pedir». Lo que no este en el documento no
 *    existe para esta funcion.
 *  - Lo que propone son PROPUESTAS. Nadie las adopta solo: la pantalla las
 *    presenta para aprobar o descartar una por una.
 */

const Esquema = z.object({
  esLaNorma: z.boolean().describe(
    "Verdadero si el documento ES el texto de la norma o su guia oficial. Falso si es otra cosa —una factura, un manual de equipo, una presentacion—. Cuando sea falso, no proponga obligaciones.",
  ),
  queEs: textoIa(200, "Que es este documento, en una linea. Si no es la norma, digalo: «Es el manual del compresor, no la norma»."),
  claveDetectada: z.string().nullable().describe(
    "La clave oficial tal como aparece EN EL DOCUMENTO: «NOM-020-STPS-2011». Null si el documento no la trae escrita. No la deduzca.",
  ),
  obligaciones: z.array(
    z.object({
      titulo: textoIa(160, "Que exige, en una linea y en imperativo. «Realizar prueba hidrostatica cada cinco años», no «pruebas»."),
      detalle: textoIa(600, "El alcance: a que equipos aplica, que hay que conservar. Null si el titulo basta.").nullable(),
      // Los cinco que el modulo ya entiende, no unos inventados para esto: lo
      // que se proponga tiene que poder amarrarse a un plan, una vigencia, un
      // registro propio o un rondin de los que ya existen.
      tipo: z.enum(["ACTIVIDAD", "DOCUMENTO", "DATO", "RECORRIDO", "CAPACITACION"]).describe(
        "ACTIVIDAD: algo que se repite y deja evidencia. DOCUMENTO: un papel que vence. DATO: una medicion que hay que registrar. RECORRIDO: una inspeccion por puntos. CAPACITACION: formar a la gente.",
      ),
      cadaMeses: z.number().nullable().describe(
        "Solo en PERIODICA y SOLO si el documento dice la frecuencia. Null si el documento no la fija: no la estime.",
      ),
      cita: textoIa(400, "El renglon del documento que sustenta esta obligacion, TEXTUAL. Sin esto la obligacion no se propone."),
      donde: textoIa(80, "Donde dice eso: el numeral o la pagina. «5.3», «pagina 12».").nullable(),
    }),
  ).describe(
    "Lo que el documento exige. Solo lo que pueda citar textualmente. Arreglo vacio si el documento no es la norma o no exige nada concreto.",
  ),
  loQueNoPudoLeer: textoIa(300, "Lo que quedo fuera: paginas ilegibles, tablas que no se entienden, anexos referidos que no vienen. Null si leyo todo.").nullable(),
});

export type LecturaDeNorma = z.infer<typeof Esquema>;

const SISTEMA = `Eres un especialista en seguridad e higiene leyendo el texto de una norma para armar la lista de lo que esa norma exige a una planta.

Trabaja SOLO con el documento que se te entrega. No uses lo que recuerdes de esa norma ni de ninguna otra: tu memoria puede traer una version derogada, y quien va a usar esto lo presenta ante un inspector.

Como trabajas:

1. Cada obligacion que propongas lleva la CITA TEXTUAL del renglon que la sustenta. Si no puedes citarla, no la propongas. No hay excepcion a esto.
2. La frecuencia solo va cuando el documento la dice. Si el documento no fija cada cuando, deja el dato vacio; estimarlo es inventarlo.
3. Una obligacion es algo que alguien tiene que HACER o CONSERVAR, verificable. Las definiciones, el campo de aplicacion y los considerandos no son obligaciones.
4. Si el documento no es la norma —es un manual de equipo, una factura, una presentacion— dilo y no propongas nada. Es mas util que forzar una lista.
5. Lo que no puedas leer, dilo. Una tabla que no se entiende o un anexo que no viene son parte de la respuesta, no algo que disimular.

Responde en español de Mexico. Concreto: quien lee esto va a aprobar o descartar cada renglon, no a estudiarlo.`;

export async function leerDocumentoDeNorma(
  org: OrgConIa,
  params: { adjuntoId: string; userId?: string | null },
): Promise<{ ok: true; lectura: LecturaDeNorma; costoUsd: number } | { ok: false; motivo: string }> {
  const veredicto = await puedeUsarIa(org, "NORMA_DOCUMENTO", {});
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const adjunto = await prisma.attachment.findFirst({
    where: { id: params.adjuntoId, organizationId: org.id, normaId: { not: null } },
    select: { id: true, name: true, mimeType: true, size: true, storagePath: true, norma: { select: { clave: true, titulo: true } } },
  });
  if (!adjunto) return { ok: false, motivo: "Ese documento no existe o no pertenece a una norma." };

  // Solo PDF: es lo que el modelo lee entero, con su diseño. Una foto de una
  // hoja se puede leer, pero una norma completa fotografiada pagina por pagina
  // no es un caso que valga la pena sostener.
  if (adjunto.mimeType !== "application/pdf") {
    return { ok: false, motivo: "Por ahora solo se puede leer un PDF. Suba la publicación oficial en ese formato." };
  }
  // Un PDF grande son decenas de miles de tokens de entrada, y el limite de la
  // peticion es real. Mas vale decirlo antes que gastar y fallar al final.
  const MAX_MB = 25;
  if (adjunto.size > MAX_MB * 1_048_576) {
    return { ok: false, motivo: `El documento pesa ${Math.round(adjunto.size / 1_048_576)} MB y el máximo para leerlo son ${MAX_MB} MB.` };
  }

  let contenido: Buffer;
  try {
    contenido = await leerArchivo(adjunto.storagePath);
  } catch {
    return { ok: false, motivo: "No se pudo leer el archivo del almacén. Intente subirlo de nuevo." };
  }

  const r = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "NORMA_DOCUMENTO",
    sistema: SISTEMA,
    instruccion:
      "Saque de este documento lo que exige, cada obligacion con su cita textual. Si el documento no es la norma, digalo y no proponga nada.",
    // La etiqueta con que lo guardaron va como CONTEXTO, no como verdad: el
    // modelo tiene que decir lo que el documento es, no repetir el nombre del
    // archivo. Sin esta distincion, subir el manual del compresor a la
    // NOM-020 devolvia obligaciones «de la NOM-020».
    contexto: {
      seGuardoComo: {
        norma: adjunto.norma?.clave ?? null,
        titulo: adjunto.norma?.titulo ?? null,
        archivo: adjunto.name,
        advertencia: "Es solo el nombre con que lo guardaron. Puede no corresponder con el documento.",
      },
    },
    esquema: Esquema,
    documento: { base64: contenido.toString("base64"), nombre: adjunto.name },
  });
  return { ok: true, lectura: r.datos, costoUsd: r.costoUsd };
}
