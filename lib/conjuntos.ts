import { prisma } from "./db";

/**
 * Conjuntos de equipos: los que sirven o no sirven como un todo.
 *
 * "La Linea 4, desde almacen de refacciones hasta producto terminado, y
 * alguien responde por que este optima." Quitele el vocabulario de manufactura
 * y queda: un conjunto de equipos, con nombre y dueno, que cruza areas y que
 * sirve o no sirve completo. En un club es "la alberca"; en un edificio, "los
 * elevadores". El objeto es el mismo y la palabra cambia —de ahi
 * `terminoConjunto` en lib/instalaciones.ts—.
 *
 * Es distinto de la ubicacion a proposito: las ubicaciones son geografia y son
 * exclusivas; los conjuntos son funcion y se traslapan. La subestacion
 * alimenta la linea, los elevadores y la alberca al mismo tiempo.
 */

export class ErrorDeConjunto extends Error {}

/** Los estados de equipo que cuentan como "abajo" para el dictamen. */
const ABAJO = "DOWN";
const A_MEDIAS = "DEGRADED";

export type EstadoConjunto = "COMPLETO" | "DEGRADADO" | "DETENIDO" | "VACIO";

export type ConjuntoEnLista = {
  id: string;
  code: string;
  name: string;
  descripcion: string | null;
  responsable: { id: string; name: string } | null;
  origen: string;
  equipos: number;
  /** Cuantos estan abajo ahora mismo, y cuantos de esos detienen la produccion. */
  abajo: number;
  abajoQueDetienen: number;
  aMedias: number;
  estado: EstadoConjunto;
  /** Cuantos equipos siguen sin lugar en el lienzo. */
  sinColocar: number;
  /**
   * El acomodo del mapa, para la miniatura de la lista: celdas y estado de
   * los equipos ya colocados. Sin nombres: solo forma y color.
   */
  plano: Array<{ x: number; y: number; w: number; h: number; estado: "OPERA" | "MEDIAS" | "ABAJO" }>;
};

/**
 * El dictamen de un conjunto, a partir del estado vivo de sus equipos.
 *
 * Se reporta lo que se sabe y no se juzga si el servicio esta disponible: que
 * uno de dos elevadores este abajo puede significar "sigue habiendo servicio"
 * o "no cumple", y eso depende del edificio, no del sistema. Decir "DETENIDO"
 * sobre un hecho que el sistema no conoce seria inventar; decir "un equipo
 * abajo, de cuatro" es verdad y el que sabe lo interpreta.
 */
export function estadoDe(c: { equipos: number; abajo: number; aMedias: number }): EstadoConjunto {
  if (c.equipos === 0) return "VACIO";
  if (c.abajo > 0) return "DETENIDO";
  if (c.aMedias > 0) return "DEGRADADO";
  return "COMPLETO";
}

export async function conjuntosDe(organizationId: string): Promise<ConjuntoEnLista[]> {
  const filas = await prisma.conjunto.findMany({
    where: { organizationId, active: true },
    select: {
      id: true, code: true, name: true, descripcion: true, origen: true,
      responsable: { select: { id: true, name: true } },
      equipos: {
        select: {
          planoX: true, planoY: true, planoAncho: true, planoAlto: true,
          asset: { select: { status: true, detieneLinea: true, active: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return filas.map((c) => {
    // Un equipo retirado no se borra de su conjunto —su historia sigue
    // valiendo—, pero tampoco puede pesar en el dictamen de hoy.
    const vivos = c.equipos.filter((e) => e.asset.active);
    const abajo = vivos.filter((e) => e.asset.status === ABAJO);
    const aMedias = vivos.filter((e) => e.asset.status === A_MEDIAS).length;
    const base = { equipos: vivos.length, abajo: abajo.length, aMedias };
    return {
      id: c.id, code: c.code, name: c.name, descripcion: c.descripcion,
      responsable: c.responsable, origen: c.origen,
      ...base,
      abajoQueDetienen: abajo.filter((e) => e.asset.detieneLinea === true).length,
      estado: estadoDe(base),
      sinColocar: vivos.filter((e) => e.planoX === null).length,
      plano: vivos
        .filter((e) => e.planoX !== null && e.planoY !== null)
        .map((e) => ({
          x: e.planoX!, y: e.planoY!, w: e.planoAncho, h: e.planoAlto,
          estado: e.asset.status === ABAJO ? "ABAJO" as const : e.asset.status === A_MEDIAS ? "MEDIAS" as const : "OPERA" as const,
        })),
    };
  });
}

export type Residual = {
  /** Nadie ha dicho nada de ellos todavia. Es tarea. */
  sinAcomodar: EquipoResidual[];
  /** Alguien decidio que van solos. Es una decision, y se respeta. */
  independientes: EquipoResidual[];
  /** Cuantos equipos vivos hay en total, para poder decir "23 de 73". */
  total: number;
};

export type EquipoResidual = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  categoria: string | null;
  status: string;
};

/**
 * Los equipos que no estan en ningun conjunto.
 *
 * ── Por que se calcula y no se crea ──
 *
 * La salida facil seria un conjunto llamado "Equipos varios". No sirve: es un
 * conjunto que alguien tiene que mantener a mano, y el dia que se de de alta
 * un compresor nuevo, ese equipo no pertenecera a nada Y NADIE SE VA A
 * ENTERAR. Calculado, el residual siempre esta exacto sin que nadie lo cuide,
 * y de paso es la medida de que tan armada esta la instalacion.
 *
 * ── Por que viene partido en dos ──
 *
 * Un equipo aislado A PROPOSITO no es lo mismo que uno que nadie ha acomodado.
 * Si el calentador del bano aparece por siempre como pendiente, la lista se
 * llena de cosas que no se van a mover, se vuelve ruido, y el dia que de
 * verdad falte acomodar algo importante ya nadie la esta viendo.
 */
export async function residualDe(organizationId: string): Promise<Residual> {
  const equipos = await prisma.asset.findMany({
    where: {
      organizationId,
      active: true,
      // Sin ninguna membresia viva. Un conjunto desactivado no cuenta como
      // hogar: si se apago la Linea 4, sus equipos vuelven a estar sueltos.
      conjuntos: { none: { conjunto: { active: true } } },
    },
    select: {
      id: true, code: true, name: true, status: true, independiente: true,
      location: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { code: "asc" },
  });

  const total = await prisma.asset.count({ where: { organizationId, active: true } });
  const mapear = (a: (typeof equipos)[number]): EquipoResidual => ({
    id: a.id, code: a.code, name: a.name, status: a.status,
    area: a.location?.name ?? null,
    categoria: a.category?.name ?? null,
  });

  return {
    sinAcomodar: equipos.filter((a) => !a.independiente).map(mapear),
    independientes: equipos.filter((a) => a.independiente).map(mapear),
    total,
  };
}

/**
 * Una clave sugerida a partir del nombre.
 *
 * Se sugiere y no se impone: la clave es del cliente y muchas plantas ya tienen
 * la suya ("L4", "SIS-ELEV"). Pero pedirla en blanco frena el alta por una
 * decision que a nadie le importa la primera vez.
 */
export function claveSugerida(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

/**
 * Que impide borrar un conjunto. Un "no se puede" sin motivo no sirve.
 *
 * Solo cuentan los equipos VIVOS. Un conjunto cuyos equipos se dieron de baja
 * quedaria imposible de borrar por membresias de cosas que ya no existen, y el
 * mensaje diria "tiene 3 equipos" de equipos que el usuario ya no ve en
 * ningun lado — la peor clase de bloqueo, el que no se puede resolver.
 */
export async function loQueImpideBorrar(
  organizationId: string,
  conjuntoId: string,
): Promise<string | null> {
  const equipos = await prisma.conjuntoAsset.count({
    where: { organizationId, conjuntoId, asset: { active: true } },
  });
  if (equipos > 0) {
    return `Tiene ${equipos} equipo${equipos === 1 ? "" : "s"} adentro. Quítelos primero, o desactívelo para conservarlo sin que aparezca.`;
  }
  return null;
}
