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
  plano: EquipoEnPlano[];
  /** Sitio asignado, o el de la mayoría de sus equipos si no se asignó. */
  sitio: { id: string; name: string; asignado: boolean } | null;
  clasificacion: string | null;
  /** Totales para las tres vistas de la lista. */
  horasParo: number;
  perdida: number;
  planesVencidos: number;
  ordenesAbiertas: number;
  /**
   * Cada equipo vivo con su categoría y sus números, para que la lista pueda
   * filtrar por categoría y recalcular los totales solo con esa categoría.
   */
  detalle: Array<{ categoriaId: string | null; status: string; detieneLinea: boolean | null; horas: number; perdida: number; planesVencidos: number; ordenesAbiertas: number }>;
};

/** Un equipo colocado en el mapa, con lo que hace falta para pintarlo en cualquiera de las tres vistas. */
export type EquipoEnPlano = {
  x: number; y: number; w: number; h: number;
  status: string; horas: number; planesVencidos: number; ordenesAbiertas: number;
  categoriaId: string | null;
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

/**
 * Las líneas con su mapa en miniatura y los datos de las tres vistas.
 *
 * El costo usa el MISMO cálculo que el mapa de cada línea (`costoDeParar`,
 * que solo cobra el paro de lo que detiene la producción), y los pendientes
 * la misma regla: planes vencidos y órdenes abiertas por equipo. Así la
 * miniatura y el mapa nunca dicen cosas distintas.
 */
export async function conjuntosDe(
  organizationId: string,
  opciones: { costo?: { desde: Date; hasta: Date } } = {},
): Promise<ConjuntoEnLista[]> {
  const filas = await prisma.conjunto.findMany({
    where: { organizationId, active: true },
    select: {
      id: true, code: true, name: true, descripcion: true, origen: true, clasificacion: true,
      responsable: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      equipos: {
        select: {
          planoX: true, planoY: true, planoAncho: true, planoAlto: true,
          asset: { select: { id: true, status: true, detieneLinea: true, active: true, siteId: true, categoryId: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const ids = [...new Set(filas.flatMap((c) => c.equipos.map((e) => e.asset.id)))];
  const ahora = new Date();
  const [planes, ordenes, sitios, costo] = await Promise.all([
    ids.length ? prisma.planAsset.findMany({ where: { organizationId, assetId: { in: ids }, active: true, nextDueDate: { lt: ahora } }, select: { assetId: true } }) : [],
    ids.length ? prisma.workOrder.findMany({ where: { organizationId, assetId: { in: ids }, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } }, select: { assetId: true } }) : [],
    prisma.site.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    opciones.costo && ids.length ? (await import("./costo-de-parar")).costoDeParar(organizationId, opciones.costo) : null,
  ]);
  const cuenta = (xs: Array<{ assetId: string | null }>) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x.assetId) m.set(x.assetId, (m.get(x.assetId) ?? 0) + 1);
    return m;
  };
  const vencidos = cuenta(planes);
  const abiertas = cuenta(ordenes);
  const paro = new Map((costo?.areas ?? []).flatMap((a) => a.equipos).map((e) => [e.assetId, e]));
  const nombreSitio = new Map(sitios.map((x) => [x.id, x.name]));

  return filas.map((c) => {
    // Un equipo retirado no se borra de su conjunto —su historia sigue
    // valiendo—, pero tampoco puede pesar en el dictamen de hoy.
    const vivos = c.equipos.filter((e) => e.asset.active);
    const abajo = vivos.filter((e) => e.asset.status === ABAJO);
    const aMedias = vivos.filter((e) => e.asset.status === A_MEDIAS).length;
    const base = { equipos: vivos.length, abajo: abajo.length, aMedias };

    // Sin sitio asignado, el de la mayoría de sus equipos: las líneas que ya
    // existían se filtran por planta sin que nadie capture nada.
    let sitio: ConjuntoEnLista["sitio"] = c.site ? { ...c.site, asignado: true } : null;
    if (!sitio) {
      const votos = new Map<string, number>();
      for (const e of vivos) if (e.asset.siteId) votos.set(e.asset.siteId, (votos.get(e.asset.siteId) ?? 0) + 1);
      const [ganador] = [...votos.entries()].sort((a, b) => b[1] - a[1]);
      if (ganador) sitio = { id: ganador[0], name: nombreSitio.get(ganador[0]) ?? "—", asignado: false };
    }

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
          x: e.planoX!, y: e.planoY!, w: e.planoAncho, h: e.planoAlto, status: e.asset.status, categoriaId: e.asset.categoryId,
          horas: paro.get(e.asset.id)?.horas ?? 0,
          planesVencidos: vencidos.get(e.asset.id) ?? 0, ordenesAbiertas: abiertas.get(e.asset.id) ?? 0,
        })),
      sitio,
      clasificacion: c.clasificacion,
      horasParo: vivos.reduce((a, e) => a + (paro.get(e.asset.id)?.horas ?? 0), 0),
      perdida: vivos.reduce((a, e) => a + (paro.get(e.asset.id)?.perdida ?? 0), 0),
      planesVencidos: vivos.reduce((a, e) => a + (vencidos.get(e.asset.id) ?? 0), 0),
      ordenesAbiertas: vivos.reduce((a, e) => a + (abiertas.get(e.asset.id) ?? 0), 0),
      detalle: vivos.map((e) => ({
        categoriaId: e.asset.categoryId, status: e.asset.status, detieneLinea: e.asset.detieneLinea,
        horas: paro.get(e.asset.id)?.horas ?? 0, perdida: paro.get(e.asset.id)?.perdida ?? 0,
        planesVencidos: vencidos.get(e.asset.id) ?? 0, ordenesAbiertas: abiertas.get(e.asset.id) ?? 0,
      })),
    };
  });
}

/**
 * La línea vista solo con una categoría de equipos: sus números se cuentan
 * únicamente con los equipos de esa categoría. El dictamen de la línea no
 * cambia —si está detenida, está detenida—, lo que cambia es de quién se habla.
 */
export function soloCategoria<T extends ConjuntoEnLista>(c: T, categoria: string): T {
  const d = c.detalle.filter((x) => x.categoriaId === categoria);
  return {
    ...c,
    equipos: d.length,
    abajo: d.filter((x) => x.status === "DOWN").length,
    abajoQueDetienen: d.filter((x) => x.status === "DOWN" && x.detieneLinea === true).length,
    aMedias: d.filter((x) => x.status === "DEGRADED").length,
    horasParo: d.reduce((a, x) => a + x.horas, 0),
    perdida: d.reduce((a, x) => a + x.perdida, 0),
    planesVencidos: d.reduce((a, x) => a + x.planesVencidos, 0),
    ordenesAbiertas: d.reduce((a, x) => a + x.ordenesAbiertas, 0),
  };
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

/**
 * El responsable y el sitio de una línea tienen que ser de la misma empresa.
 * Sin esto, conociendo un identificador se podía poner como responsable a una
 * persona de otra empresa. Devuelve el motivo si algo no es válido.
 */
export async function referenciasInvalidas(
  organizationId: string,
  r: { responsableId?: string | null; siteId?: string | null },
): Promise<string | null> {
  if (r.responsableId) {
    const u = await prisma.user.count({ where: { id: r.responsableId, organizationId, active: true } });
    if (!u) return "El responsable no existe o no está activo";
  }
  if (r.siteId) {
    const s = await prisma.site.count({ where: { id: r.siteId, organizationId } });
    if (!s) return "El sitio no existe";
  }
  return null;
}

/** La clasificación, limpia: sin espacios de más y con mayúscula inicial. Vacía = sin clasificar. */
export function clasificacionLimpia(t?: string | null): string | null {
  const v = (t ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : null;
}
