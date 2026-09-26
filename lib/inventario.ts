import { AYUDA } from "./ayuda";
import { ROLES, menuDe, type Rol } from "./pantallas";
import { FUNCIONES_IA, type ClaveFuncionIA } from "./ia/funciones";
import { ALCANCES } from "./integraciones/alcances";
import { EVENTOS_WEBHOOK } from "./avisos/catalogo";

/**
 * Todo lo que el sistema tiene y qué hace, armado del código.
 *
 * ── Por qué generado y no escrito ──
 *
 * Un inventario escrito a mano describe, a los dos meses, un sistema que ya no
 * existe: se agregan pantallas, se renombran otras, y nadie vuelve al
 * documento. Aquí cada renglón sale de donde vive la verdad —el menú, las
 * fichas de ayuda, el registro de funciones de IA, los permisos de la API— y
 * `--revisar` del generador bloquea el despliegue si el documento se quedó
 * atrás.
 *
 * ── Lo que este documento NO dice ──
 *
 * Qué usa cada cliente. Tener la función y tenerla en marcha son cosas
 * distintas: medido en producción, ninguna de las cuentas tenía centros de
 * costo capturados ni refacciones en sus planes. Un inventario leído como
 * «todo esto ya está operando en todas partes» promete lo que no es.
 */

export type PantallaInventariada = {
  href: string;
  etiqueta: string;
  /** Qué es esa pantalla, de su ficha de ayuda. */
  que: string;
  /** Lo que se puede hacer ahí. */
  hacer: string[];
  /** Los roles que la ven. */
  roles: Rol[];
};

export type GrupoInventariado = { seccion: string; pantallas: PantallaInventariada[] };

/** Las pantallas por grupo, con lo que hace cada una y quién la ve. */
export function pantallasInventariadas(): GrupoInventariado[] {
  const ayuda = AYUDA as Record<string, { que: string; hacer: string[] } | undefined>;
  // El menú del propietario es el completo: de ahí salen todas, y para cada una
  // se calcula qué roles la ven.
  return menuDe("OWNER").map((g) => ({
    seccion: g.seccion,
    pantallas: g.items.map((i) => ({
      href: i.href,
      etiqueta: i.etiqueta,
      que: ayuda[i.href]?.que ?? "",
      hacer: ayuda[i.href]?.hacer ?? [],
      roles: ROLES.filter((r) => menuDe(r).some((x) => x.items.some((y) => y.href === i.href))),
    })),
  })).filter((g) => g.pantallas.length);
}

/** Cuántas pantallas ve cada rol: contesta «¿no será mucho para mi gente?». */
export function pantallasPorRol(): Array<{ rol: Rol; cuantas: number }> {
  return ROLES.map((rol) => ({
    rol,
    cuantas: menuDe(rol).reduce((a, g) => a + g.items.length, 0),
  }));
}

export const COMO_SE_LLAMA_EL_ROL: Record<Rol, string> = {
  OWNER: "Propietario",
  ADMIN: "Administración",
  SUPERVISOR: "Supervisión",
  TECHNICIAN: "Técnico",
  COMPRAS: "Compras",
  REQUESTER: "Solicitante",
  VIEWER: "Consulta",
};

/** Las funciones de IA, con lo que hace cada una y lo que consume. */
export function funcionesDeIa() {
  return (Object.keys(FUNCIONES_IA) as ClaveFuncionIA[])
    .filter((k) => FUNCIONES_IA[k].disponible)
    .map((k) => ({
      clave: k,
      nombre: FUNCIONES_IA[k].nombre,
      descripcion: FUNCIONES_IA[k].descripcion,
      operaciones: FUNCIONES_IA[k].operaciones,
    }));
}

/** Los números de un vistazo. Todos contados, ninguno escrito. */
export function elTamanoDelSistema() {
  const grupos = pantallasInventariadas();
  return {
    pantallas: grupos.reduce((a, g) => a + g.pantallas.length, 0),
    grupos: grupos.length,
    funcionesDeIa: funcionesDeIa().length,
    permisosDeApi: Object.keys(ALCANCES).length,
    eventosDeWebhook: EVENTOS_WEBHOOK.length,
    roles: ROLES.length,
  };
}
