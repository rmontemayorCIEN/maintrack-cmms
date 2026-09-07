/**
 * Deteccion de riesgo en un reporte, en codigo y sin IA.
 *
 * Tiene que ser instantanea y no puede depender de que un servicio externo
 * este arriba: alguien que escribe "huele a gas" necesita que el aviso salga
 * como critico en el mismo segundo, no cuando un supervisor abra la bandeja
 * mañana. Y el reportante no puede esperar a un modelo con el dedo en Enviar.
 *
 * Es deliberadamente burda y de gatillo facil: un falso positivo cuesta que
 * alguien revise un reporte antes de tiempo; un falso negativo puede costar
 * mucho mas. La IA la refina segundos despues, cuando alguien mira la bandeja.
 */

type Patron = { que: string; palabras: RegExp };

const PATRONES: Patron[] = [
  {
    que: "posible fuga de gas",
    palabras: /\b(gas|huele a gas|olor a gas|fuga de gas|huevo podrido|azufre)\b/i,
  },
  {
    que: "riesgo eléctrico",
    // Por proximidad y no por palabras pegadas: la gente escribe "el cable
    // esta pelado", "los cables quedaron expuestos", no "cable pelado".
    palabras: /(\b(cable|cables|alambre|contacto|apagador|tablero)\b.{0,30}\b(pelad\w*|expuest\w*|descubiert\w*|sin forro|chispe\w*)|hace corto|corto ?circuito|chispa|chispas|\bda toque\b|descarga electrica|electrocut\w*)/i,
  },
  {
    que: "fuego o calor anormal",
    palabras: /\b(fuego|incendio|se quema|quemado|humo|arde|ardiendo|muy caliente|calentando demasiado|se calienta mucho|olor a quemado)\b/i,
  },
  {
    que: "riesgo de caida o desprendimiento",
    palabras: /\b(se va a caer|se esta cayendo|colgando|desprend\w+|suelto y colgando|a punto de caer)\b/i,
  },
  {
    que: "persona lesionada o en peligro",
    palabras: /\b(lastim\w+|herid\w+|golpe\w+|accidente|atrapad\w+|se corto|sangr\w+)\b/i,
  },
  {
    que: "agua sobre instalación electrica",
    palabras: /\b(agua.{0,30}(electric|contacto|tablero|cable)|(electric|contacto|tablero|cable).{0,30}(mojad|agua|inund))\w*/i,
  },
  {
    que: "fuga de agua importante",
    palabras: /\b(inundad\w+|inundacion|se esta inundando|chorro de agua|brota agua)\b/i,
  },
];

export type Riesgo = { nivel: "NINGUNO" | "ALTO"; motivo: string | null };

/**
 * Se comparan textos sin acentos.
 *
 * La gente escribe "esta" y "está", "corto" y "cortó", desde un teclado de
 * telefono y con prisa. Un detector de riesgo que se rompe con un acento no
 * sirve en español: los patrones se escriben sin acento y el texto se
 * normaliza antes de compararlo.
 */
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function evaluarRiesgo(...textos: Array<string | null | undefined>): Riesgo {
  const crudo = textos.filter(Boolean).join(" ");
  if (!crudo.trim()) return { nivel: "NINGUNO", motivo: null };
  const texto = sinAcentos(crudo);

  const encontrados = PATRONES.filter((p) => p.palabras.test(texto)).map((p) => p.que);
  if (!encontrados.length) return { nivel: "NINGUNO", motivo: null };

  return { nivel: "ALTO", motivo: encontrados.join(" · ") };
}
