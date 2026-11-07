// Lo que se revisa de la respuesta del modelo ANTES de enseñarla.
//
// Una cifra que no estaba en el contexto no se marca: la respuesta no se
// enseña (como el copiloto de Avisos). Un enlace a una pantalla que no está en
// el plan ni en la ayuda se quita. Las notas propuestas pasan por las mismas
// reglas que una nota escrita a mano.

import type { Nota, PasoPlan, PropuestaNota } from "../tipos";
import { LIMITES, propuestasValidas } from "./memoria";

/// Los números de dos cifras o más que aparecen en `texto` y en ninguna fuente.
export function cifrasAjenas(texto: string, fuentes: string[]): string[] {
  const limpio = (x: string) => x.replace(/[,.]/g, "").replace(/^0+(?=\d)/, "");
  const conocidas = new Set(fuentes.flatMap((f) => f.match(/\d[\d,.]*\d|\d/g) ?? []).map(limpio));
  return [...new Set((texto.match(/\d[\d,.]*\d|\d/g) ?? []).map(limpio))].filter((n) => n.length >= 2 && !conocidas.has(n));
}

export type RespuestaCruda = { respuesta?: unknown; enlace?: unknown; pasoClave?: unknown; notasPropuestas?: unknown; resumen?: unknown };

export type RespuestaRevisada = {
  respuesta: string;
  enlace: { href: string; texto: string } | null;
  pasoClave: string | null;
  notasPropuestas: PropuestaNota[];
  resumen: string;
};

export function revisarRespuesta(
  cruda: RespuestaCruda | null | undefined,
  o: { pasos: PasoPlan[]; rutas: { href: string; texto: string }[]; fuentes: string[]; notas: Pick<Nota, "texto">[] },
): { ok: true; r: RespuestaRevisada } | { ok: false; motivo: string } {
  const respuesta = typeof cruda?.respuesta === "string" ? cruda.respuesta.trim() : "";
  if (!respuesta) return { ok: false, motivo: "vacia" };
  if (respuesta.length > LIMITES.respuesta) return { ok: false, motivo: "larga" };
  const ajenas = cifrasAjenas(respuesta, o.fuentes);
  if (ajenas.length) return { ok: false, motivo: `cifras: ${ajenas.join(", ")}` };

  // El enlace se acepta por su ruta (sin «?s=…» de más) y lleva el texto de la app, no el del modelo.
  const pedido = typeof cruda?.enlace === "string" ? cruda.enlace.trim() : "";
  const enlace = pedido ? o.rutas.find((x) => x.href === pedido) ?? o.rutas.find((x) => x.href.split("?")[0] === pedido.split("?")[0]) ?? null : null;
  const pasoClave = typeof cruda?.pasoClave === "string" && o.pasos.some((p) => p.clave === cruda.pasoClave) ? cruda.pasoClave : null;
  const resumen = typeof cruda?.resumen === "string" ? cruda.resumen.replace(/\s+/g, " ").trim().slice(0, LIMITES.resumen) : "";
  return { ok: true, r: { respuesta, enlace, pasoClave, notasPropuestas: propuestasValidas(cruda?.notasPropuestas, o.notas), resumen } };
}

/// Las pantallas a las que el Consultor puede mandar: las del plan y las de la ayuda.
/// A quien no administra, nunca la de un paso de la administración: un enlace no
/// lleva a una pantalla que la persona no puede abrir. (Las fichas ya llegan
/// filtradas por rol: eso lo sabe la app.)
export function rutasPermitidas(pasos: PasoPlan[], fichas: { ruta: string; titulo: string }[], puedeAdministrar = true): { href: string; texto: string }[] {
  const vistas = new Map<string, string>();
  for (const p of pasos) if (!vistas.has(p.enlace) && (puedeAdministrar || !p.soloAdmin)) vistas.set(p.enlace, p.textoEnlace);
  for (const f of fichas) if (!vistas.has(f.ruta)) vistas.set(f.ruta, `Abrir ${f.titulo}`);
  return [...vistas].map(([href, texto]) => ({ href, texto }));
}
