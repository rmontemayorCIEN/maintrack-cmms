/**
 * La historia de la construccion de planes: una foto por semana.
 *
 * El tablero del constructor deriva todo de los datos de hoy, y eso es lo
 * correcto —no hay dos porcentajes que se contradigan—. El precio es que hacia
 * atras no hay nada: se puede decir cuantos planes estan listos ahora, pero no
 * cuantos lo estaban hace seis semanas, porque «listo» no se guardo nunca.
 *
 * Esta es la unica pieza del constructor que SI persiste una cifra, y solo
 * sirve hacia adelante. Por eso la toma la tarea programada que ya corre a
 * diario en vez de un trabajo nuevo que alguien tenga que crear en la nube: un
 * trabajo que nadie creo es una curva que nunca empieza, y eso no se nota hasta
 * que alguien la pide tres meses despues.
 *
 * La foto es idempotente por semana: pasar todos los dias deja una sola fila,
 * la del ultimo dia que paso. Asi la semana en curso se va actualizando y las
 * anteriores quedan congeladas.
 */
import { prisma } from "./db";
import { ZONA_POR_OMISION, claveDiaEnZona, diaEnZona, medianocheEnZona } from "./periodos";
import { constructorDePlanes } from "./constructor-planes";

/** Cuantas semanas se miran por omision en la pantalla. */
export const SEMANAS_DE_HISTORIA = 12;

/** Dia de la semana ISO (1 lunes … 7 domingo) de un instante en la zona. */
function diaSemanaEnZona(instante: Date, zona: string): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short" }).format(instante);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[d] ?? 1;
}

/**
 * La clave de la semana: el lunes de esa semana, "aaaa-mm-dd" en la zona de la
 * empresa. Se usa el lunes y no el numero de semana ISO porque ordena solo,
 * se lee sin traducir y no tiene el caso raro de la semana 53.
 */
export function claveDeSemana(instante: Date, zona: string): string {
  const dia = diaSemanaEnZona(instante, zona);
  const d = diaEnZona(instante, zona);
  const medianoche = medianocheEnZona(d.anio, d.mes, d.dia, zona);
  // Se resta con 12 h de holgura por el cambio de horario: restar dias exactos
  // puede caer en la hora que no existe y correr la fecha un dia.
  const lunes = new Date(medianoche.getTime() - (dia - 1) * 86_400_000 + 12 * 3_600_000);
  return claveDiaEnZona(lunes, zona);
}

export type FotoSemanal = {
  semana: string;
  planes: number;
  listos: number;
  enForma: number;
  esqueleto: number;
  sugeridos: number;
  meta: number;
  equiposTotal: number;
  equiposCubiertos: number;
};

/**
 * Guarda como va la construccion en la semana en curso.
 *
 * Devuelve la foto y si es la primera de esa semana, para que la tarea
 * programada pueda reportar lo que de verdad cambio.
 */
export async function tomarFotoDeConstruccion(
  organizationId: string,
  ahora = new Date(),
): Promise<{ foto: FotoSemanal; nueva: boolean }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const semana = claveDeSemana(ahora, org?.timezone || ZONA_POR_OMISION);
  const c = await constructorDePlanes(organizationId);

  const datos = {
    planes: c.construidos,
    listos: c.porEstado.listos,
    enForma: c.porEstado.enForma,
    esqueleto: c.porEstado.esqueleto,
    sugeridos: c.sugeridos,
    meta: c.meta,
    equiposTotal: c.equiposTotal,
    equiposCubiertos: c.equiposCubiertos,
  };

  const previa = await prisma.fotoDeConstruccion.findUnique({
    where: { organizationId_semana: { organizationId, semana } },
    select: { id: true },
  });
  await prisma.fotoDeConstruccion.upsert({
    where: { organizationId_semana: { organizationId, semana } },
    create: { organizationId, semana, ...datos, tomadaEl: ahora },
    update: { ...datos, tomadaEl: ahora },
  });

  return { foto: { semana, ...datos }, nueva: !previa };
}

/** Las ultimas semanas, de la mas vieja a la mas nueva: asi se dibuja. */
export async function historiaDeConstruccion(
  organizationId: string,
  semanas = SEMANAS_DE_HISTORIA,
): Promise<FotoSemanal[]> {
  const filas = await prisma.fotoDeConstruccion.findMany({
    where: { organizationId },
    orderBy: { semana: "desc" },
    take: Math.max(1, Math.min(semanas, 104)),
    select: {
      semana: true, planes: true, listos: true, enForma: true, esqueleto: true,
      sugeridos: true, meta: true, equiposTotal: true, equiposCubiertos: true,
    },
  });
  return filas.reverse();
}
