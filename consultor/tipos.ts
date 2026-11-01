// El contrato entre el Consultor y cada app.
//
// El Consultor no sabe nada de seguros, mantenimiento ni impuestos: cada app le
// entrega su plan de implementación (calculado con SUS datos), sus fichas de
// ayuda y su perfil. Con eso acompaña, y con nada más.

import type { Trato } from "./textos";

/// HECHO y NO_APLICA no se trabajan; EN_PROCESO y FALTA, sí.
export type EstadoPaso = "HECHO" | "EN_PROCESO" | "FALTA" | "NO_APLICA";

/// ARRANQUE: lo que se configura una vez. OPERACION: lo que prueba que ya se usa.
export type EtapaPaso = "ARRANQUE" | "OPERACION";

export type PasoPlan = {
  clave: string;
  titulo: string;
  /// Qué se hace en este paso, en una línea.
  que: string;
  /// Qué se pierde quien no lo hace.
  porQue: string;
  /// Lo dice la app con sus datos: las palomitas son hechos, no opiniones.
  estado: EstadoPaso;
  /// Lo que falta, en una línea. Vacío cuando está hecho.
  falta: string;
  /// Registros que ya están bien, de los que se necesitan. Nulo en los de sí o no.
  progreso: { hecho: number; meta: number } | null;
  /// La pantalla donde se hace.
  enlace: string;
  textoEnlace: string;
  etapa: EtapaPaso;
  /// Cuánto pesa en el avance (1 a 5).
  peso: number;
  /// Pasos que conviene terminar antes de este.
  despuesDe?: string[];
  /// Solo quien administra la cuenta lo puede hacer.
  soloAdmin?: boolean;
};

export type TipoNota = "META" | "FECHA" | "NECESIDAD" | "EQUIPO" | "COMPROMISO";

export type Nota = { id: string; tipo: TipoNota; texto: string; autor: string; creadaEn: string };

/// Lo que el Consultor recuerda. El avance NO está aquí: se calcula cada vez.
export type Memoria = {
  /// El último paso que se trabajó con el Consultor: «dónde se quedó».
  pasoActual: string | null;
  /// Resumen corto de la última conversación.
  resumen: string;
  ultimaVez: string | null;
  notas: Nota[];
};

export type ClasePregunta = "IMPLEMENTACION" | "OPERACION" | "FUERA_DE_TEMA" | "CONSEJO_EXPERTO";

/// La ficha de ayuda de una pantalla, en el formato de Maintrack.
export type FichaConsultor = {
  ruta: string;
  titulo: string;
  que: string;
  hacer: string[];
  flujo: string[];
  noPuedo?: { sintoma: string; porque: string }[];
};

export type PerfilApp = {
  nombre: string;
  /// Para quién es: «agentes de seguros y sus equipos».
  para: string;
  /// Temas en los que el Consultor no aconseja: solo explica cómo se registran en la app.
  sinConsejoDe: string[];
  /// Cómo le habla a la persona: «tu» (de fábrica) o «usted».
  trato?: Trato;
};

export type MensajeConsultor = { id: string; de: "USUARIO" | "CONSULTOR"; texto: string; fecha: string; enlace?: { href: string; texto: string } | null };

export type PropuestaNota = { tipo: TipoNota; texto: string };

/// Lo que la pantalla recibe después de preguntar.
export type Contestacion = {
  respuesta: string;
  clase: ClasePregunta;
  enlace: { href: string; texto: string } | null;
  notasPropuestas: PropuestaNota[];
};

export type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
