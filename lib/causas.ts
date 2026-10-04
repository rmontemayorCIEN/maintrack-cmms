/**
 * Las familias de causa raiz: por que falla la planta, agrupado.
 *
 * ── Por que existe este archivo ──
 *
 * La lista vivia dentro del editor de catalogos, como las opciones de un
 * desplegable. Ahi cumplia para capturar y para nada mas: el dato se guardaba
 * y no lo leia nadie. Ni un reporte ni un indicador agrupaba por familia,
 * asi que la pregunta que justifica capturarla —«¿que parte de mis fallas son
 * por practica de mantenimiento y cual por desgaste normal?»— no se podia
 * contestar. Un campo escrito sin lector, que es el defecto que este proyecto
 * ya conoce.
 *
 * Al sacarla aqui, la MISMA lista alimenta el desplegable con que se captura y
 * el agrupado con que se analiza. Copiarla en los dos lados era garantizar que
 * un dia dijeran cosas distintas.
 *
 * ── Sin dependencias, a proposito ──
 *
 * La usan pantallas de cliente. Importar de aqui algo que toque la base
 * dejaria al navegador con «no encuentro fs», que en este proyecto ya costo
 * una pantalla en blanco.
 *
 * ── Que se hace con cada una ──
 *
 * La `accion` no es adorno: una familia sirve si dice a quien le toca. Un
 * pico en DESGASTE se ataca cambiando frecuencias del preventivo; uno en
 * OPERACION se ataca con capacitacion, y no hay plan de mantenimiento que lo
 * arregle. Sin eso, el grafico es una curiosidad.
 */

export type FamiliaDeCausa = {
  clave: string;
  etiqueta: string;
  /** Que hacer cuando esta familia encabeza. Lo que vuelve util el numero. */
  accion: string;
};

export const FAMILIAS_DE_CAUSA: FamiliaDeCausa[] = [
  { clave: "MANTENIMIENTO", etiqueta: "Práctica de mantenimiento",
    accion: "Se ataca con el plan: frecuencias, rutas que no se ejecutan, procedimientos incompletos." },
  { clave: "INSTALACION", etiqueta: "Instalación o montaje",
    accion: "Se ataca con procedimiento de montaje y verificación después de intervenir." },
  { clave: "OPERACION", etiqueta: "Operación",
    accion: "No se arregla con mantenimiento: es capacitación y condiciones de uso." },
  { clave: "DESGASTE", etiqueta: "Desgaste normal",
    accion: "Es vida útil. Se ataca con reemplazo programado, no con más correctivos." },
  { clave: "AMBIENTE", etiqueta: "Ambiente",
    accion: "Corrosión, humedad, polvo: se ataca con protección y con el entorno, no con la máquina." },
  { clave: "EXTERNO", etiqueta: "Causa externa",
    accion: "Energía, suministro, terceros. Se documenta y se escala; el área no lo controla." },
  { clave: "DISENO", etiqueta: "Diseño o selección",
    accion: "El equipo no da para lo que se le pide. Se ataca con ingeniería o con reemplazo." },
  { clave: "OTRO", etiqueta: "Otro",
    accion: "Si esta familia crece, conviene revisar si falta una familia propia." },
];

/** Para el desplegable del editor de catalogos. */
export const OPCIONES_DE_FAMILIA = FAMILIAS_DE_CAUSA.map((f) => ({ valor: f.clave, etiqueta: f.etiqueta }));

/**
 * Como se nombra una familia en pantalla.
 *
 * Una clave que no este en la lista se enseña TAL CUAL, no se traduce a
 * «Otro»: si en la base hay un valor que aqui no existe —la API acepta texto
 * libre en ese campo— esconderlo detras de «Otro» seria contar una cifra
 * falsa. Que se vea raro es justamente lo que hace que se corrija.
 */
export function etiquetaDeFamilia(clave: string | null | undefined): string {
  if (!clave) return "Causa sin familia";
  return FAMILIAS_DE_CAUSA.find((f) => f.clave === clave)?.etiqueta ?? clave;
}

export function accionDeFamilia(clave: string | null | undefined): string | null {
  if (!clave) return null;
  return FAMILIAS_DE_CAUSA.find((f) => f.clave === clave)?.accion ?? null;
}
