/**
 * El lector del catálogo normativo.
 *
 * El CONTENIDO ya no vive aquí: vive en `catalogo-normativo/normas.json`, un
 * paquete neutral y versionado que se comparte copiándolo. Este archivo solo
 * lo carga, lo valida y lo expone con tipos. El porqué de esa separación está
 * en `catalogo-normativo/LEEME.md`.
 *
 * Hoy el único consumidor es MainTrack. Está preparado para más, no conectado
 * a más.
 *
 * ── Por qué se valida al cargar
 *
 * Porque un catálogo mal formado no puede servirse a medias. Si una norma se
 * queda sin `fueraDeAlcance`, el cliente ve una pantalla que le deja creer que
 * con eso ya cumplió todo — y ese es exactamente el daño que este módulo no
 * puede hacer. Mejor que truene al arrancar, y por eso además
 * `scripts/revisar-catalogo-normativo.ts` corre en el despliegue y bloquea
 * antes de que llegue a producción.
 */
import { z } from "zod";
import paquete from "../catalogo-normativo/normas.json";
import { ORDEN_TIPOS_OBLIGACION, type TipoObligacion } from "./normas-tipos";

export const esquemaObligacion = z.object({
  clave: z.string().min(1),
  titulo: z.string().min(3),
  detalle: z.string().min(10),
  tipo: z.enum(ORDEN_TIPOS_OBLIGACION as [TipoObligacion, ...TipoObligacion[]]),
  cadaDias: z.number().int().min(1).max(3650).optional(),
  // Sin esto nadie sabe qué tiene que quedar guardado, y la obligación se
  // vuelve un buen deseo.
  evidencia: z.string().min(10),
});

export const esquemaNorma = z.object({
  clave: z.string().min(3),
  titulo: z.string().min(3),
  emisor: z.string().nullable(),
  giros: z.array(z.string().min(2)).min(1),
  resumen: z.string().min(20),
  /**
   * Obligatorio a propósito. Es el único campo que está ahí para proteger al
   * usuario de nosotros: dice lo que la norma pide y el sistema NO lleva.
   */
  fueraDeAlcance: z.string().min(30),
  version: z.number().int().min(1),
  obligaciones: z.array(esquemaObligacion).min(1),
});

export const esquemaPaquete = z.object({
  contrato: z.literal(1),
  version: z.number().int().min(1),
  publicado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revisadoPor: z.object({ nombre: z.string(), fecha: z.string() }).nullable(),
  normas: z.array(esquemaNorma).min(1),
});

const leido = esquemaPaquete.safeParse(paquete);
if (!leido.success) {
  // El mensaje dice DÓNDE, porque quien edite el JSON necesita encontrarlo.
  const donde = leido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
  throw new Error(`El catálogo normativo (catalogo-normativo/normas.json) no es válido — ${donde}`);
}

export type ObligacionDeCatalogo = z.infer<typeof esquemaObligacion>;
export type NormaDeCatalogo = z.infer<typeof esquemaNorma>;

/** La versión del CONTENIDO que trae esta copia del paquete. */
export const VERSION_CATALOGO = leido.data.version;
export const PUBLICADO_CATALOGO = leido.data.publicado;

/**
 * Quién revisó el contenido y cuándo. `null` significa BORRADOR: lo redactó
 * alguien que no es especialista en seguridad e higiene, y mientras siga en
 * null la pantalla tiene que decirlo (`CATALOGO_EN_BORRADOR`).
 */
export const REVISADO_POR = leido.data.revisadoPor;

export const NORMAS: NormaDeCatalogo[] = leido.data.normas;

export const NORMAS_POR_CLAVE: Record<string, NormaDeCatalogo> = Object.fromEntries(
  NORMAS.map((n) => [n.clave, n]),
);

export const normaDeCatalogo = (clave: string): NormaDeCatalogo | null => NORMAS_POR_CLAVE[clave] ?? null;

/** Las que se le proponen a una empresa por su tipo de instalación. */
export function normasParaGiro(giro: string | null | undefined): NormaDeCatalogo[] {
  if (!giro) return NORMAS;
  const suyas = NORMAS.filter((n) => n.giros.includes(giro));
  // Un giro que no reconocemos ve todo el catálogo en vez de una lista vacía:
  // es mejor que elija de más a que concluya que no le aplica nada.
  return suyas.length ? suyas : NORMAS;
}

export function obligacionDeCatalogo(claveNorma: string, claveObligacion: string) {
  return normaDeCatalogo(claveNorma)?.obligaciones.find((o) => o.clave === claveObligacion) ?? null;
}

/** Cuántas obligaciones trae el catálogo en total. Lo usa la pantalla y la prueba. */
export const TOTAL_OBLIGACIONES = NORMAS.reduce((a, n) => a + n.obligaciones.length, 0);
