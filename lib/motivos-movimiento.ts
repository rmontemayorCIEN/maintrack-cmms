/**
 * Por que entro o se ajusto material, con nombre y apellido.
 *
 * Antes el motivo era texto libre y opcional. Medido en produccion: las
 * salidas, los traspasos y las devoluciones llevaban su documento el 100% de
 * las veces; las entradas, el 15%. Y todos los ajustes manuales decian lo
 * mismo, «Ajuste manual», que no distingue un error de dedo de una merma ni de
 * una perdida —y esos tres se atienden muy distinto—.
 *
 * ── Por que catalogo Y nota, no catalogo solo ──
 *
 * Es el mismo patron con el que ya se cierra una orden correctiva: un codigo
 * de falla del catalogo MAS la resolucion escrita. Cada uno hace lo que el
 * otro no puede.
 *
 * El catalogo permite agrupar. Sin el no hay forma de contestar «cuanto
 * material entro este año sin venir de una compra, y por que», que es una
 * pregunta de control: material que aparece en el almacen sin respaldo.
 *
 * La nota guarda lo que ningun catalogo captura. «Sobrante del proyecto de la
 * linea 2» dice cual proyecto y cual linea. Si solo hubiera lista, todos
 * elegirian «Otro» y ese dato se perderia; por eso en «Otro» la nota no es
 * opcional.
 *
 * ── Este archivo no importa nada ──
 *
 * A proposito, para que lo pueda usar el formulario del almacen sin arrastrar
 * prisma al navegador. Es el mismo criterio de `lib/estados-compra.ts`, que lo
 * aprendio por las malas: la compilacion se caia con un «no encuentro tls» que
 * no decia nada de la causa.
 */

export type MotivoEntrada =
  | "DEVOLUCION_OBRA" | "COMPRA_SIN_ORDEN" | "GARANTIA"
  | "PRESTAMO_EXTERNO" | "FABRICACION_INTERNA" | "OTRO_ENTRADA";

export type MotivoAjuste =
  | "ERROR_CAPTURA" | "MERMA" | "DANO_O_PERDIDA" | "CONTEO_FISICO" | "OTRO_AJUSTE";

export type MotivoMovimiento = MotivoEntrada | MotivoAjuste;

type Definicion = {
  nombre: string;
  /** Que caso cubre, para que nadie tenga que adivinar cual elegir. */
  ayuda: string;
  /** Con esto puesto, la nota deja de ser opcional. */
  pideNota?: boolean;
};

export const MOTIVOS_ENTRADA: Record<MotivoEntrada, Definicion> = {
  DEVOLUCION_OBRA: {
    nombre: "Devolución de obra o sobrante",
    ayuda: "Volvió material que se había sacado y no se usó.",
  },
  COMPRA_SIN_ORDEN: {
    nombre: "Compra sin orden previa",
    ayuda: "Se compró de emergencia, sin requisición. Conviene registrar la compra después.",
    pideNota: true,
  },
  GARANTIA: {
    nombre: "Garantía o reposición del proveedor",
    ayuda: "El proveedor repuso una pieza que falló.",
  },
  PRESTAMO_EXTERNO: {
    nombre: "Préstamo o traspaso de otra planta",
    ayuda: "Llegó de otra planta, otra empresa del grupo o un préstamo.",
    pideNota: true,
  },
  FABRICACION_INTERNA: {
    nombre: "Fabricación interna",
    ayuda: "Lo hizo el taller o se armó con material propio.",
  },
  OTRO_ENTRADA: {
    nombre: "Otro",
    ayuda: "Cualquier otra razón. Aquí sí hay que explicarla.",
    pideNota: true,
  },
};

export const MOTIVOS_AJUSTE: Record<MotivoAjuste, Definicion> = {
  ERROR_CAPTURA: {
    nombre: "Corrección de un error de captura",
    ayuda: "El saldo estaba mal por una captura equivocada, no porque falte o sobre material.",
  },
  MERMA: {
    nombre: "Merma o caducidad",
    ayuda: "Material que se echó a perder, caducó o ya no sirve.",
  },
  DANO_O_PERDIDA: {
    nombre: "Daño o pérdida",
    ayuda: "Se dañó, se perdió o no aparece. No es lo mismo que una merma y conviene separarlo.",
    pideNota: true,
  },
  CONTEO_FISICO: {
    nombre: "Ajuste por conteo físico",
    ayuda: "Se contó el anaquel y el saldo no coincidía.",
  },
  OTRO_AJUSTE: {
    nombre: "Otro",
    ayuda: "Cualquier otra razón. Aquí sí hay que explicarla.",
    pideNota: true,
  },
};

const TODOS: Record<string, Definicion> = { ...MOTIVOS_ENTRADA, ...MOTIVOS_AJUSTE };

/** Los motivos que corresponden a un tipo de movimiento. */
export function motivosDe(tipo: string): Array<{ clave: string } & Definicion> {
  const mapa = tipo === "IN" ? MOTIVOS_ENTRADA : tipo === "ADJUST" ? MOTIVOS_AJUSTE : null;
  if (!mapa) return [];
  return Object.entries(mapa).map(([clave, d]) => ({ clave, ...d }));
}

/** Si esta clave sirve para este tipo de movimiento. No basta con que exista. */
export function motivoValido(tipo: string, clave: string | null | undefined): boolean {
  if (!clave) return false;
  return motivosDe(tipo).some((m) => m.clave === clave);
}

/** Si este motivo obliga a explicar. */
export function pideNota(clave: string | null | undefined): boolean {
  return Boolean(clave && TODOS[clave]?.pideNota);
}

/** Como se lee en pantalla y en el kardex. */
export function nombreDeMotivo(clave: string | null | undefined): string | null {
  return clave ? TODOS[clave]?.nombre ?? clave : null;
}

/** Los tipos de movimiento que piden motivo del catalogo. */
export const TIPOS_CON_MOTIVO = ["IN", "ADJUST"];
