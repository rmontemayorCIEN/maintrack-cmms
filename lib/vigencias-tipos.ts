/**
 * Los tipos de vigencia y como se llaman en pantalla.
 *
 * Vive aparte de `lib/vigencias.ts` a proposito: las listas y las fichas son
 * componentes de cliente y solo necesitan estos nombres. Si los tomaran del
 * modulo con la logica, el empaquetador arrastraria prisma y el envio de
 * avisos al paquete del navegador, y la compilacion se cae con un «no
 * encuentro tls» que no dice nada de la causa. Es el mismo criterio de
 * `lib/estados-compra.ts` y `lib/comentarios-tipos.ts`.
 */

/** De que puede colgar una vigencia. Exactamente una por vigencia. */
export const ANCLAJES = ["assetId", "partId", "userId", "serviceId"] as const;
export type Anclaje = (typeof ANCLAJES)[number];

export type DefinicionVigencia = {
  nombre: string;
  /** Una linea: que es, para quien no lo tiene claro. */
  descripcion: string;
  /** Dias de anticipacion por omision. */
  avisarDias: number;
  /** De que suele colgar. El primero es el que la pantalla ofrece primero. */
  anclajes: Anclaje[];
  /** Si tiene sentido decir a quien se le reclama. */
  pideProveedor: boolean;
};

const d = (x: DefinicionVigencia) => x;

/**
 * Los dias de anticipacion no son iguales y no es un detalle: una poliza se
 * renueva con meses de anticipacion porque hay que cotizar, y una calibracion
 * con semanas porque se agenda con el laboratorio. Poner 30 a todo era
 * garantizar que la mitad avisara tarde y la otra mitad demasiado pronto.
 */
export const TIPOS_VIGENCIA = {
  GARANTIA: d({
    nombre: "Garantía",
    descripcion: "Lo que el proveedor cubre sin costo, y hasta cuándo. Si llega una falla dentro del plazo, se le reclama a él.",
    avisarDias: 30, anclajes: ["assetId", "partId"], pideProveedor: true,
  }),
  POLIZA_SEGURO: d({
    nombre: "Póliza de seguro",
    descripcion: "El seguro del equipo o de la planta, con su número de póliza y su aseguradora.",
    avisarDias: 60, anclajes: ["assetId"], pideProveedor: true,
  }),
  FIANZA: d({
    nombre: "Fianza",
    descripcion: "La fianza de cumplimiento de un proveedor o de una obra.",
    avisarDias: 60, anclajes: ["serviceId", "assetId"], pideProveedor: true,
  }),
  CONTRATO_SERVICIO: d({
    nombre: "Contrato o póliza de servicio",
    descripcion: "El contrato de mantenimiento de un tercero: qué cubre, desde cuándo y hasta cuándo.",
    avisarDias: 60, anclajes: ["serviceId", "assetId"], pideProveedor: true,
  }),
  CALIBRACION: d({
    nombre: "Calibración",
    descripcion: "El certificado de calibración de un instrumento. Se agenda con el laboratorio, así que conviene saberlo antes.",
    avisarDias: 30, anclajes: ["assetId"], pideProveedor: true,
  }),
  PERMISO: d({
    nombre: "Permiso de operación",
    descripcion: "El permiso que necesita un equipo para operar: recipientes a presión, grúas, montacargas, calderas.",
    avisarDias: 45, anclajes: ["assetId"], pideProveedor: false,
  }),
  LICENCIA: d({
    nombre: "Licencia o acreditación",
    descripcion: "La licencia de una persona: operador de grúa, montacargas, trabajos en altura, espacios confinados.",
    avisarDias: 45, anclajes: ["userId"], pideProveedor: false,
  }),
  CERTIFICADO: d({
    nombre: "Certificado o capacitación",
    descripcion: "Una capacitación con vigencia: DC-3, primeros auxilios, manejo de sustancias.",
    avisarDias: 45, anclajes: ["userId", "assetId"], pideProveedor: false,
  }),
  OTRO: d({
    nombre: "Otro documento con vigencia",
    descripcion: "Cualquier otro papel que se vence y que alguien tiene que renovar a tiempo.",
    avisarDias: 30, anclajes: ["assetId", "serviceId", "userId", "partId"], pideProveedor: false,
  }),
} as const;

export type TipoVigencia = keyof typeof TIPOS_VIGENCIA;
export const ORDEN_TIPOS = Object.keys(TIPOS_VIGENCIA) as TipoVigencia[];
export const esTipoVigencia = (t: string): t is TipoVigencia => t in TIPOS_VIGENCIA;
export const nombreDeTipo = (t: string) => (esTipoVigencia(t) ? TIPOS_VIGENCIA[t].nombre : t);

/** Cuantos dias antes avisar: el de la vigencia, o el de su tipo. */
export const diasDeAviso = (v: { tipo: string; avisarDias?: number | null }) =>
  v.avisarDias ?? (esTipoVigencia(v.tipo) ? TIPOS_VIGENCIA[v.tipo].avisarDias : 30);

export type EstadoVigencia = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "CANCELADA" | "SIN_VENCIMIENTO";

export const ETIQUETA_ESTADO: Record<EstadoVigencia, string> = {
  VIGENTE: "Vigente", POR_VENCER: "Por vencer", VENCIDA: "Vencida",
  CANCELADA: "Cancelada", SIN_VENCIMIENTO: "Sin vencimiento",
};

/**
 * En que estado esta, calculado. No se guarda: un estado guardado se queda
 * viejo en cuanto pasa la medianoche y nadie toca el registro, y entonces la
 * pantalla dice «Vigente» de algo que vencio ayer.
 */
export function estadoDeVigencia(
  v: { tipo: string; hasta?: Date | string | null; activa?: boolean; avisarDias?: number | null },
  ahora: Date = new Date(),
): EstadoVigencia {
  if (v.activa === false) return "CANCELADA";
  if (!v.hasta) return "SIN_VENCIMIENTO";
  const hasta = typeof v.hasta === "string" ? new Date(v.hasta) : v.hasta;
  if (hasta.getTime() < ahora.getTime()) return "VENCIDA";
  const dias = (hasta.getTime() - ahora.getTime()) / 86_400_000;
  return dias <= diasDeAviso(v) ? "POR_VENCER" : "VIGENTE";
}

/** Dias que faltan (negativo si ya vencio). Nulo si no caduca. */
export function diasParaVencer(hasta: Date | string | null | undefined, ahora: Date = new Date()): number | null {
  if (!hasta) return null;
  const h = typeof hasta === "string" ? new Date(hasta) : hasta;
  return Math.ceil((h.getTime() - ahora.getTime()) / 86_400_000);
}
