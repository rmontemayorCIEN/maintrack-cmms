import { prisma } from "./db";
import { pantallasDelMenu, puedeVerRuta, menuDe, type GrupoMenu, type ItemMenu } from "./pantallas";
import { puedeVerTabla } from "./registros-tipos";

/**
 * Los accesos rápidos de cada persona: sus pantallas, arriba del menú.
 *
 * ── Por qué existen ──
 *
 * El menú llegó a 33 pantallas en 8 grupos. Cada quien usa una cuarta parte,
 * pero no la misma: el almacenista vive en existencias y requisiciones, y
 * dirección en indicadores y reportes. Lo que cada uno usa está repartido
 * entre grupos distintos, y bajar tres veces al mismo renglón todos los días
 * cansa.
 *
 * ── Por qué NO se reordena ni se renombra el menú ──
 *
 * Se evaluó dejar que cada empresa armara su propia estructura y se descartó.
 * `lib/pantallas.ts` no solo pinta el menú: de sus etiquetas salen los
 * destinos del comando de voz (`lib/navegacion-voz.ts`), y las 51 fichas de
 * ayuda describen la navegación con esos nombres. Si un cliente llama
 * «Bodega» a Almacén, deja de funcionarle decir «llévame a almacén», la ayuda
 * con IA describe una pantalla que él no ve, y el soporte por teléfono se
 * vuelve imposible.
 *
 * Un favorito no cambia nada de eso: es la MISMA pantalla, con su mismo
 * nombre, puesta más cerca.
 */

/**
 * Cuántos caben.
 *
 * Ocho porque un acceso rápido de veinte renglones vuelve a ser un menú, y
 * entonces no resolvió nada: solo movió el problema más arriba.
 */
export const MAXIMO_FAVORITOS = 8;

export type OpcionesDeAcceso = {
  esSuperAdmin?: boolean;
  esDemo?: boolean;
  registrosPropios?: boolean;
  cumplimientoNormas?: boolean;
};

/** Las pantallas FIJAS que esta persona puede anclar. */
export function pantallasAnclables(rol: string | undefined, opciones: OpcionesDeAcceso = {}) {
  // El contrato se revisa TAMBIEN aqui: `puedeVerRuta` solo sabe de roles, y
  // sin esto «Lo que mas uso» ofrecia anclar una pantalla que la empresa no
  // contrato —y el ancla llevaba a «se contrata aparte»—.
  return pantallasDelMenu().filter(
    (i) => puedeVerRuta(rol, i.href, opciones)
      && (!i.requiereRegistros || opciones.registrosPropios)
      && (!i.requiereNormas || opciones.cumplimientoNormas),
  );
}

/**
 * Las tablas propias que esta persona puede anclar, como items de menú.
 *
 * ── Por qué las tablas SÍ se anclan y el menú NO se vuelve dinámico
 *
 * Nadie busca «Registros propios»: el almacenista busca «Bitácora de diésel».
 * Meter las tablas del cliente al menú de todos resolvería eso y rompería
 * cuatro cosas de golpe, porque `lib/pantallas.ts` no solo pinta el menú —de
 * ahí salen también los permisos por ruta, los destinos del comando de voz y
 * las fichas de ayuda indexadas por ruta—.
 *
 * Un favorito no toca nada de eso: es personal, no cambia el menú de nadie, y
 * la voz y la ayuda siguen hablando de «Registros propios», que es la pantalla
 * que de verdad existe. El almacenista se pone su bitácora arriba y ya.
 *
 * Quién ve cada tabla lo decide la tabla (`rolesVer`), igual que en su propia
 * pantalla: no se puede anclar lo que no se puede abrir.
 */
export async function tablasAnclables(
  organizationId: string,
  rol: string | undefined,
  opciones: OpcionesDeAcceso = {},
): Promise<ItemMenu[]> {
  if (!opciones.registrosPropios) return [];
  if (!puedeVerRuta(rol, "/registros", opciones)) return [];

  const tablas = await prisma.tablaPropia.findMany({
    where: { organizationId, activa: true },
    select: { clave: true, nombre: true, rolesVer: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });

  return tablas
    .filter((t) => puedeVerTabla(rol, t, { esSuperAdmin: opciones.esSuperAdmin }))
    .map((t) => ({ href: `/registros/${t.clave}`, etiqueta: t.nombre, icono: "registros" }));
}

/** Todo lo que se puede anclar: las pantallas fijas más las tablas propias. */
export async function anclables(
  organizationId: string,
  rol: string | undefined,
  opciones: OpcionesDeAcceso = {},
): Promise<ItemMenu[]> {
  return [...pantallasAnclables(rol, opciones), ...(await tablasAnclables(organizationId, rol, opciones))];
}

/**
 * Lo anclable, agrupado como se ofrece en Ajustes.
 *
 * Las tablas propias van en su propio grupo y con SU nombre —«Bitácora de
 * diésel»—, que es como las busca quien las usa.
 */
export async function gruposParaAnclar(
  organizationId: string,
  rol: string | undefined,
  opciones: OpcionesDeAcceso = {},
): Promise<GrupoMenu[]> {
  const grupos = menuDe(rol, opciones);
  const tablas = await tablasAnclables(organizationId, rol, opciones);
  if (!tablas.length) return grupos;
  return [...grupos, { seccion: "Sus tablas", clave: "tablas-propias", items: tablas }];
}

/**
 * Los favoritos de alguien, ya listos para pintar.
 *
 * Se cruzan con lo que esa persona PUEDE ver hoy: si cambió de rol y perdió
 * acceso a una pantalla, su favorito desaparece en vez de llevarla a un «esta
 * pantalla no es de su rol». El registro se queda —si le devuelven el permiso
 * vuelve a aparecer— porque borrarlo por un cambio temporal de rol le tiraría
 * una preferencia que no pidió cambiar.
 */
export async function favoritosDe(
  organizationId: string,
  userId: string,
  rol: string | undefined,
  opciones: OpcionesDeAcceso = {},
): Promise<ItemMenu[]> {
  const guardados = await prisma.pantallaFavorita.findMany({
    where: { userId },
    orderBy: { posicion: "asc" },
    select: { ruta: true },
  });
  if (!guardados.length) return [];
  /*
   * Se cruza con lo anclable de HOY, y eso vale también para las tablas: si la
   * tabla se apagó o le cerraron el rol, su acceso rápido desaparece en vez de
   * llevarlo a un «Sin permiso». El registro se queda por si vuelve.
   */
  const porRuta = new Map((await anclables(organizationId, rol, opciones)).map((i) => [i.href, i]));
  return guardados.flatMap((f) => {
    const item = porRuta.get(f.ruta);
    return item ? [item] : [];
  });
}

export class ErrorDeFavoritos extends Error {}

/**
 * Reemplaza la lista completa, en el orden que llega.
 *
 * Se guarda todo de un golpe y no uno por uno: así el orden es el que la
 * persona ve al guardar, sin estados intermedios donde la posición 3 existe
 * dos veces.
 */
export async function guardarFavoritos(params: {
  organizationId: string;
  userId: string;
  rutas: string[];
  rol: string | undefined;
  opciones?: OpcionesDeAcceso;
}) {
  const permitidas = new Set(
    (await anclables(params.organizationId, params.rol, params.opciones ?? {})).map((i) => i.href),
  );
  // Sin repetidas y solo lo que puede ver: un `href` inventado no entra.
  const limpias = [...new Set(params.rutas)].filter((r) => permitidas.has(r));
  if (limpias.length > MAXIMO_FAVORITOS) {
    throw new ErrorDeFavoritos(`Caben ${MAXIMO_FAVORITOS} accesos rápidos. Quite alguno antes de agregar otro.`);
  }

  await prisma.$transaction([
    prisma.pantallaFavorita.deleteMany({ where: { userId: params.userId } }),
    ...limpias.map((ruta, i) =>
      prisma.pantallaFavorita.create({
        data: { organizationId: params.organizationId, userId: params.userId, ruta, posicion: i },
      }),
    ),
  ]);
  return limpias;
}
