// Quitar datos personales de la pregunta ANTES de mandarla a la IA y de
// guardarla: lo que se guarda es lo mismo que vio la IA.
//
// Correos, CURP, RFC y números largos (teléfono, cuenta, tarjeta) salen; los
// nombres que la app pase (la gente de la empresa) se vuelven {persona}. Los
// nombres de terceros que nadie conoce no se pueden reconocer: por eso la
// pantalla pide no escribirlos.
//
// Viene del limpiador de Agente 360 (lib/ia/privacidad.ts), con su corrección
// del 31 oct 2026: un teléfono seguido de coma o punto también sale.

import { plano } from "./texto";

export function sinDatosPersonales(texto: string, nombres: string[] = []): string {
  const suyas = new Set(nombres.flatMap((n) => plano(n).split(/\s+/)).filter((w) => w.length >= 3));
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, "[CURP]")
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi, "[RFC]")
    // Ocho dígitos o más: la coma o el punto solo son parte de la cifra si les sigue otro dígito («12,500.00»).
    .replace(/(?<!\d|\d[,.])(\+?\d[\d\s-]{6,}\d)(?!\d|[,.]\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[número]" : m))
    .replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (w) => (suyas.has(plano(w)) ? "{persona}" : w))
    .replace(/\{persona\}(\s+\{persona\})+/g, "{persona}");
}
