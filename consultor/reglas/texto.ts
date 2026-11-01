// Texto sin acentos ni mayúsculas, para comparar. Propio y no del núcleo: el
// Consultor se copia también a apps que no tienen el núcleo (Maintrack, Avisos).

export function plano(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const VACIAS = new Set([
  "como", "para", "donde", "cuando", "porque", "que", "cual", "cuales", "quien", "esto", "esta", "este", "estos", "estas", "eso", "esa", "ese",
  "una", "uno", "unos", "unas", "los", "las", "del", "con", "sin", "por", "mas", "muy", "pero", "algo", "todo", "todos", "tengo", "puedo",
  "hago", "hacer", "quiero", "necesito", "tiene", "tienen", "hay", "sobre", "entre", "desde", "hasta", "ya", "aqui", "ahi", "mis", "mio", "tus",
]);

/// Las palabras que dicen algo: sin acentos, de 4 letras o más y sin las vacías.
export function palabras(s: string): string[] {
  return plano(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !VACIAS.has(w));
}
