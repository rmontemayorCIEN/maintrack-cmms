/**
 * Buscar en la ayuda de las pantallas, para contestar soporte.
 *
 * Sale de `lib/ayuda.ts`, el mismo catalogo que alimenta el panel de ayuda y la
 * ayuda con IA. No se copia ni se resume: se busca y se devuelve la ficha
 * completa, para que el agente conteste con lo que el sistema dice de si mismo
 * y no con lo que cree recordar.
 *
 * La busqueda es por palabras, sin modelo: cuesta cero y da siempre lo mismo
 * para la misma pregunta. El que interpreta es el agente que la llama.
 */
import { AYUDA, CAMPO_BUSCABLE, CONTROLES_TABLA, type FichaAyuda } from "../ayuda";

/** Palabras que aparecen en todo y no distinguen nada. */
const VACIAS = new Set(
  ("a al algo como con cual cuales cuando de del donde el ella en es esa ese eso esta este esto hay la las le lo los mas me mi mis " +
    "no o para pero por porque puede puedo que se si sin sobre son su sus te tiene un una uno unos y ya yo hacer hago como").split(" "),
);

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function terminos(pregunta: string): string[] {
  return [...new Set(normalizar(pregunta).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 2 && !VACIAS.has(t)))];
}

/** Las partes de una ficha, con cuanto pesa encontrar la palabra en cada una. */
function partes(f: FichaAyuda): Array<{ texto: string; peso: number }> {
  return [
    { texto: f.titulo, peso: 5 },
    { texto: f.que, peso: 3 },
    { texto: (f.preguntas ?? []).map((p) => `${p.pregunta} ${p.respuesta}`).join(" "), peso: 3 },
    { texto: (f.noPuedo ?? []).map((n) => `${n.sintoma} ${n.porque}`).join(" "), peso: 2 },
    { texto: f.hacer.join(" "), peso: 1 },
    { texto: f.flujo.join(" "), peso: 1 },
    { texto: [...(f.campos ?? []), ...(f.botones ?? [])].map((c) => `${c.nombre} ${c.explica}`).join(" "), peso: 1 },
  ];
}

/** Coincide por raiz: «ordenes» encuentra «orden», «vencidas» encuentra «vencida». */
function aparece(termino: string, texto: string): boolean {
  const raiz = termino.length > 5 ? termino.slice(0, termino.length - 2) : termino;
  return texto.includes(raiz);
}

export function puntuar(f: FichaAyuda, ts: string[]): number {
  const ps = partes(f).map((p) => ({ ...p, texto: normalizar(p.texto) }));
  let total = 0;
  let distintos = 0;
  for (const t of ts) {
    let alguno = false;
    for (const p of ps) {
      if (aparece(t, p.texto)) { total += p.peso; alguno = true; }
    }
    if (alguno) distintos++;
  }
  // Una ficha que tiene TODAS las palabras gana a una que repite una sola.
  return total * (1 + distintos / Math.max(ts.length, 1));
}

/** La ficha completa como texto, en el orden en que la lee una persona. */
export function fichaComoTexto(ruta: string, f: FichaAyuda): string {
  const l: string[] = [`# ${f.titulo} (${ruta})`, "", f.que, ""];
  if (f.hacer.length) l.push("## Qué se puede hacer", ...f.hacer.map((x) => `- ${x}`), "");
  if (f.flujo.length) l.push("## De dónde viene y a dónde va", ...f.flujo.map((x) => `- ${x}`), "");
  if (f.campos?.length) l.push("## Campos", ...f.campos.map((c) => `- ${c.nombre}: ${c.explica}`), "");
  if (f.botones?.length) l.push("## Botones", ...f.botones.map((c) => `- ${c.nombre}: ${c.explica}`), "");
  if (f.tablaConfigurable) l.push("## Controles de la tabla", ...CONTROLES_TABLA.map((c) => `- ${c.nombre}: ${c.explica}`), "");
  if (f.camposBuscables) l.push(`## ${CAMPO_BUSCABLE.titulo}`, CAMPO_BUSCABLE.explica, "");
  if (f.noPuedo?.length) l.push("## Por qué el sistema puede decir que no", ...f.noPuedo.map((n) => `- ${n.sintoma}: ${n.porque}`), "");
  if (f.preguntas?.length) l.push("## Preguntas frecuentes", ...f.preguntas.map((p) => `- ${p.pregunta} ${p.respuesta}`), "");
  return l.join("\n").trim();
}

export function buscarEnAyuda(pregunta: string, limite: number) {
  const ts = terminos(pregunta);
  const fichas = Object.entries(AYUDA);
  const puntuadas = fichas
    .map(([ruta, f]) => ({ ruta, f, puntos: ts.length ? puntuar(f, ts) : 0 }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, limite);

  return {
    terminosBuscados: ts,
    fichasEnCatalogo: fichas.length,
    resultados: puntuadas.map((x) => ({
      pantalla: x.f.titulo,
      ruta: x.ruta,
      relevancia: Math.round(x.puntos * 10) / 10,
      contenido: fichaComoTexto(x.ruta, x.f),
    })),
    // Sin resultados, la lista de pantallas: que el agente pueda reintentar
    // con la palabra que usa el sistema y no quedarse en «no encontre nada».
    ...(puntuadas.length ? {} : { pantallasDisponibles: fichas.map(([ruta, f]) => `${f.titulo} (${ruta})`) }),
  };
}
