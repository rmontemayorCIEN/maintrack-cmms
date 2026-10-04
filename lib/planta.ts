/**
 * Como esta la planta, por partes: la franja del inicio.
 *
 * La pregunta que un jefe de mantenimiento hace primero no es «cuantas
 * ordenes hay» sino «DONDE esta el problema». El inicio contestaba lo primero
 * con una lista de ordenes y no contestaba lo segundo en ningun lado, aunque
 * el sistema ya sabe la respuesta: cada equipo tiene area y estado vivo.
 *
 * ── Por que por area cuando no hay sistemas ──
 *
 * El mapa de sistemas (`/conjuntos`) es el agrupamiento bueno: lo arma quien
 * conoce la planta y puede cruzar areas. Pero hay que capturarlo, y una
 * cuenta recien abierta no tiene ninguno —en Acero Industrial son 0 de 14—,
 * asi que una franja que dependiera de el arrancaria en blanco justo cuando
 * mas falta hace. El area si viene desde el alta del equipo. Entonces: si la
 * empresa tiene sistemas, se agrupa por sistema; si no, por area, y la propia
 * franja invita a crearlos.
 *
 * ── Lo que NO se hace aqui ──
 *
 * No se dibuja otro lienzo. El croquis de la planta ya existe en «Donde para
 * la planta» y el de cada sistema en su mapa; repetirlos seria garantizar que
 * un dia digan cosas distintas. Esta franja es una lista compacta que manda a
 * esos dos.
 *
 * Tampoco se inventa un dictamen propio: `estadoDe()` de `lib/conjuntos.ts`
 * es el unico lugar donde se decide si un grupo de equipos esta completo,
 * degradado o detenido, y de ahi sale tambien el de un area.
 */
import { prisma } from "./db";
import { estadoDe, type EstadoConjunto } from "./conjuntos";
import { OT_ACTIVAS } from "./avisos/situaciones";
import { filtroDeVencidas } from "./vencimiento";
import { alertaAbierta } from "./alertas";
import { repartirEnCuadros } from "./barra";

/** Un equipo dado de baja no es parte de la planta viva y no cuenta en nada. */
const FUERA = "RETIRED";

/**
 * Cuantos renglones se pintan. Con mas, la franja deja de leerse de un
 * vistazo —que es lo unico que justifica su lugar en el inicio— y se vuelve
 * otra lista larga. Los que no caben se resumen en una linea y se ven
 * completos en su pantalla.
 */
export const MAX_FILAS = 8;

export type FilaDePlanta = {
  id: string;
  nombre: string;
  enlace: string;
  /** Equipos vivos del grupo (sin los dados de baja). */
  equipos: number;
  abajo: number;
  aMedias: number;
  reserva: number;
  operando: number;
  estado: EstadoConjunto;
  /** Ordenes de trabajo abiertas de sus equipos, y cuantas de esas ya vencieron. */
  abiertas: number;
  vencidas: number;
  /** Alertas predictivas sin atender. */
  alertas: number;
  /** Como estan sus equipos, en palabras. Siempre dice algo. */
  comoEstan: string;
  /** Lo que trae pendiente, en palabras. Nulo cuando no debe nada. */
  pendientes: string | null;
};

export type FranjaDePlanta = {
  agrupadoPor: "sistema" | "area";
  filas: FilaDePlanta[];
  /** Grupos que no cupieron en MAX_FILAS. */
  masGrupos: number;
  /** Equipos vivos en total y cuantos de ellos no estan en ningun grupo. */
  equipos: number;
  sinGrupo: number;
  /**
   * Ordenes vencidas que no cuelgan de ningun equipo y por eso no caen en
   * ninguna fila. Se dicen en el pie: callarlas haria que la franja sumara
   * menos que la cifra de arriba sin explicar por que.
   */
  vencidasSinEquipo: number;
  /** A donde se va por el detalle: el croquis o el mapa de sistemas. */
  enlace: { texto: string; href: string };
};

type Grupo = { id: string; nombre: string; enlace: string };

/** Los grupos y a cual pertenece cada equipo vivo. */
async function agrupar(organizationId: string): Promise<{
  agrupadoPor: "sistema" | "area";
  grupos: Map<string, Grupo>;
  deEquipo: Map<string, string>;
} | null> {
  const enSistemas = await prisma.conjuntoAsset.findMany({
    // Acotado por el `organizationId` del propio renglon, que es el que lleva
    // indice; el del conjunto obligaria a cruzar la tabla para filtrar.
    where: { organizationId, conjunto: { active: true }, asset: { status: { not: FUERA } } },
    select: { assetId: true, conjunto: { select: { id: true, name: true } } },
  });

  if (enSistemas.length) {
    const grupos = new Map<string, Grupo>();
    const deEquipo = new Map<string, string>();
    for (const e of enSistemas) {
      grupos.set(e.conjunto.id, { id: e.conjunto.id, nombre: e.conjunto.name, enlace: `/conjuntos/${e.conjunto.id}` });
      // Un equipo puede estar en dos sistemas; para la franja cuenta en el
      // primero, porque el total de abajo tiene que sumar los equipos de la
      // planta y no las veces que aparecen.
      if (!deEquipo.has(e.assetId)) deEquipo.set(e.assetId, e.conjunto.id);
    }
    return { agrupadoPor: "sistema", grupos, deEquipo };
  }

  const conArea = await prisma.asset.findMany({
    where: { organizationId, status: { not: FUERA }, locationId: { not: null } },
    select: { id: true, locationId: true, location: { select: { id: true, name: true } } },
  });
  if (!conArea.length) return null;

  const grupos = new Map<string, Grupo>();
  const deEquipo = new Map<string, string>();
  for (const a of conArea) {
    if (!a.location) continue;
    grupos.set(a.location.id, { id: a.location.id, nombre: a.location.name, enlace: `/assets?locationId=${a.location.id}` });
    deEquipo.set(a.id, a.location.id);
  }
  return { agrupadoPor: "area", grupos, deEquipo };
}

/**
 * Como estan los equipos del grupo, en una frase.
 *
 * Va aparte de los pendientes A PROPOSITO. La primera version escogia UNA
 * sola cosa que decir —lo mas grave— y un area con un equipo caido y cinco
 * ordenes vencidas solo mostraba lo primero: los renglones dejaban de poder
 * sumarse y el total de arriba parecia no cuadrar con la franja. Ahora cada
 * renglon dice siempre las dos cosas, y lo que sea cero se calla.
 */
function comoEstanLos(f: Pick<FilaDePlanta, "abajo" | "aMedias" | "reserva" | "equipos">): string {
  const partes = [
    f.abajo ? `${f.abajo} fuera de servicio` : null,
    f.aMedias ? `${f.aMedias} ${f.aMedias === 1 ? "degradado" : "degradados"}` : null,
  ].filter(Boolean);
  if (partes.length) return partes.join(" · ");
  return f.reserva && f.reserva === f.equipos ? "Todo en reserva" : "Todo operando";
}

/** Lo que el grupo trae pendiente. Nulo cuando no debe nada. */
function pendientesDe(f: Pick<FilaDePlanta, "vencidas" | "alertas">): string | null {
  const partes = [
    f.vencidas ? `${f.vencidas} ${f.vencidas === 1 ? "vencida" : "vencidas"}` : null,
    f.alertas ? `${f.alertas} ${f.alertas === 1 ? "alerta" : "alertas"}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/** Lo peor arriba: primero lo detenido, luego lo degradado, y dentro de eso lo mas atrasado. */
const PESO: Record<EstadoConjunto, number> = { DETENIDO: 0, DEGRADADO: 1, COMPLETO: 2, VACIO: 3 };
function porGravedad(a: FilaDePlanta, b: FilaDePlanta) {
  return PESO[a.estado] - PESO[b.estado]
    || b.vencidas - a.vencidas
    || b.alertas - a.alertas
    || a.nombre.localeCompare(b.nombre, "es");
}

/**
 * La franja de la planta. Nula cuando no hay con que dibujarla —ningun equipo
 * tiene area ni sistema—, porque una franja vacia en el arranque solo ocupa
 * lugar y hace dudar de que el sistema tenga datos.
 */
export async function franjaDePlanta(
  organizationId: string,
  ahora = new Date(),
  zona = "America/Mexico_City",
): Promise<FranjaDePlanta | null> {
  const grupal = await agrupar(organizationId);
  if (!grupal) return null;
  const { agrupadoPor, grupos, deEquipo } = grupal;

  const [vivos, abiertas, alertas] = await Promise.all([
    prisma.asset.findMany({
      where: { organizationId, status: { not: FUERA } },
      select: { id: true, status: true },
    }),
    // Solo las abiertas: son decenas, no el historico. La fecha de
    // vencimiento se compara con el MISMO criterio de toda la aplicacion.
    prisma.workOrder.findMany({
      where: { organizationId, status: { in: OT_ACTIVAS }, assetId: { not: null } },
      select: { id: true, assetId: true, dueDate: true },
    }),
    prisma.predictiveAlert.findMany({
      where: { organizationId, ...alertaAbierta() },
      select: { assetId: true },
    }),
  ]);

  const [conEquipo, vencidasSinEquipo] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId, ...filtroDeVencidas(zona, ahora), assetId: { not: null } },
      select: { id: true },
    }),
    prisma.workOrder.count({ where: { organizationId, ...filtroDeVencidas(zona, ahora), assetId: null } }),
  ]);
  const vencidas = new Set(conEquipo.map((o) => o.id));

  const base = new Map<string, FilaDePlanta>();
  for (const g of grupos.values()) {
    base.set(g.id, {
      id: g.id, nombre: g.nombre, enlace: g.enlace,
      equipos: 0, abajo: 0, aMedias: 0, reserva: 0, operando: 0,
      estado: "VACIO", abiertas: 0, vencidas: 0, alertas: 0, comoEstan: "", pendientes: null,
    });
  }

  let sinGrupo = 0;
  for (const a of vivos) {
    const fila = base.get(deEquipo.get(a.id) ?? "");
    if (!fila) { sinGrupo++; continue; }
    fila.equipos++;
    if (a.status === "DOWN") fila.abajo++;
    else if (a.status === "DEGRADED") fila.aMedias++;
    else if (a.status === "STANDBY") fila.reserva++;
    else fila.operando++;
  }

  for (const o of abiertas) {
    const fila = base.get(deEquipo.get(o.assetId ?? "") ?? "");
    if (!fila) continue;
    fila.abiertas++;
    if (vencidas.has(o.id)) fila.vencidas++;
  }

  for (const al of alertas) {
    const fila = base.get(deEquipo.get(al.assetId) ?? "");
    if (fila) fila.alertas++;
  }

  const todas = [...base.values()]
    .filter((f) => f.equipos > 0)
    .map((f) => {
      f.estado = estadoDe({ equipos: f.equipos, abajo: f.abajo, aMedias: f.aMedias });
      f.comoEstan = comoEstanLos(f);
      f.pendientes = pendientesDe(f);
      return f;
    })
    .sort(porGravedad);

  if (!todas.length) return null;

  return {
    agrupadoPor,
    filas: todas.slice(0, MAX_FILAS),
    masGrupos: Math.max(todas.length - MAX_FILAS, 0),
    equipos: vivos.length,
    sinGrupo,
    vencidasSinEquipo,
    enlace: agrupadoPor === "sistema"
      ? { texto: "Mapa de sistemas", href: "/conjuntos" }
      : { texto: "Ver los equipos", href: "/assets" },
  };
}

export { SEGMENTOS } from "./barra";

export type Segmento = "abajo" | "aMedias" | "reserva" | "operando";

/**
 * La barra de una fila, como lista de cuadros.
 *
 * El reparto vive en `lib/barra.ts` porque el almacen dibuja lo mismo. Ahi
 * esta explicado por que lo malo nunca desaparece de la barra.
 */
export function barraDe(f: Pick<FilaDePlanta, "equipos" | "abajo" | "aMedias" | "reserva" | "operando">): Segmento[] {
  return repartirEnCuadros<Segmento>(
    [["abajo", f.abajo], ["aMedias", f.aMedias], ["reserva", f.reserva], ["operando", f.operando]],
    f.equipos,
    "operando",
  );
}
