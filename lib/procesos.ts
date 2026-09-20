import { prisma } from "./db";

/**
 * Candado y bitacora de los procesos que corren solos.
 *
 * El defecto que lo origino (Bloque 8): ningun cron tenia candado. Cloud
 * Scheduler reintenta ante un tiempo agotado o un 5xx, y Cloud Run puede
 * atender ese reintento en OTRA instancia mientras la primera sigue
 * trabajando. En el programador de preventivos eso son dos ordenes identicas
 * para el mismo plan y el mismo equipo, cada una con su folio y su aviso,
 * porque la decision se toma contra una lectura hecha al inicio del barrido
 * y la escritura ocurre mucho despues.
 *
 * El candado vive en la base y no en memoria: un `Map` en el proceso solo
 * protege dentro de una instancia, y aqui hay varias. Se toma con escritura
 * condicional —el mismo patron que ya usan el inventario, el cierre de orden
 * y la restauracion de la demo—, asi que dos intentos simultaneos no pueden
 * ganar los dos.
 *
 * Y caduca. Un proceso que se muere a la mitad no deja el candado puesto para
 * siempre: pasado `expiraEl`, el siguiente lo toma. Es la contraparte
 * necesaria de bloquear.
 *
 * De paso resuelve la otra mitad del problema: que un proceso deje de correr
 * hoy es indistinguible de que corra sin novedad, porque los dos callan. Con
 * `ultimoFin` y `fallasSeguidas` se puede preguntar.
 */

/** Cuanto vale un candado sin renovar. Los cron tienen 300 s de tope. */
export const MINUTOS_DE_CANDADO = 10;

export type Corrida<T> =
  | { corrio: true; resultado: T }
  | { corrio: false; motivo: string };

function texto(valor: unknown, maximo: number) {
  const crudo = typeof valor === "string" ? valor : JSON.stringify(valor) ?? "";
  return crudo.length > maximo ? `${crudo.slice(0, maximo - 1)}…` : crudo;
}

/**
 * Corre `fn` solo si nadie mas lo esta corriendo con la misma clave.
 *
 * Devuelve `corrio: false` en vez de reventar cuando el candado esta tomado:
 * que el reintento del cron encuentre ocupado NO es un error, es exactamente
 * lo que debe pasar.
 */
export async function conCandado<T>(
  clave: string,
  fn: () => Promise<T>,
  opciones: { organizationId?: string | null; minutos?: number } = {},
): Promise<Corrida<T>> {
  const ahora = new Date();
  const expiraEl = new Date(ahora.getTime() + (opciones.minutos ?? MINUTOS_DE_CANDADO) * 60_000);

  // La fila tiene que existir para poder tomarla con una escritura
  // condicional. Se consulta antes de crear para no ensuciar los registros
  // con un choque de llave primaria en cada corrida: despues de la primera
  // vez la fila ya esta. Si aun asi dos creaciones coinciden, la que pierde
  // sigue adelante y compite por el candado como cualquiera.
  const existe = await prisma.procesoProgramado.findUnique({ where: { clave }, select: { clave: true } });
  if (!existe) {
    await prisma.procesoProgramado
      .create({ data: { clave, organizationId: opciones.organizationId ?? null } })
      .catch(() => undefined);
  }

  const tomado = await prisma.procesoProgramado.updateMany({
    where: { clave, OR: [{ corriendoDesde: null }, { expiraEl: { lt: ahora } }] },
    data: { corriendoDesde: ahora, expiraEl, ultimoInicio: ahora },
  });
  if (!tomado.count) return { corrio: false, motivo: "ya está corriendo" };

  try {
    const resultado = await fn();
    await prisma.procesoProgramado.update({
      where: { clave },
      data: {
        corriendoDesde: null, expiraEl: null, ultimoFin: new Date(),
        ultimoOk: true, ultimoResumen: texto(resultado, 1000), ultimoError: null,
        fallasSeguidas: 0, corridas: { increment: 1 },
      },
    });
    return { corrio: true, resultado };
  } catch (error) {
    // El candado se suelta aunque haya fallado: dejarlo puesto convierte un
    // error de una corrida en un proceso detenido diez minutos.
    await prisma.procesoProgramado.update({
      where: { clave },
      data: {
        corriendoDesde: null, expiraEl: null, ultimoFin: new Date(),
        ultimoOk: false, ultimoError: texto(error instanceof Error ? error.message : error, 500),
        fallasSeguidas: { increment: 1 }, corridas: { increment: 1 },
      },
    });
    throw error;
  }
}

/** Lo que debe correr solo, y cada cuanto se espera que lo haga. */
export const PROCESOS_VIGILADOS: Array<{ clave: string; nombre: string; cadaMinutos: number }> = [
  { clave: "cron:avisos", nombre: "Avisos y cola de entregas", cadaMinutos: 5 },
  { clave: "cron:scheduler", nombre: "Programador de preventivos", cadaMinutos: 60 },
  { clave: "cron:disponibles", nombre: "Actividades que ya se pueden hacer", cadaMinutos: 60 },
  { clave: "cron:diagnostico", nombre: "Diagnóstico semanal", cadaMinutos: 60 * 24 * 7 },
];

/**
 * Como va cada proceso vigilado: cuando termino por ultima vez, si fallo, y
 * si lleva tanto sin correr que algo debe estar roto.
 *
 * El margen es de tres veces su periodo antes de darlo por callado: un
 * reintento o un arranque en frio no deben encender una alarma.
 */
export async function estadoDeProcesos() {
  const filas = await prisma.procesoProgramado.findMany({
    where: { clave: { in: PROCESOS_VIGILADOS.map((p) => p.clave) } },
  });
  const ahora = Date.now();
  return PROCESOS_VIGILADOS.map((p) => {
    const fila = filas.find((f) => f.clave === p.clave);
    const desdeMinutos = fila?.ultimoFin ? Math.round((ahora - fila.ultimoFin.getTime()) / 60_000) : null;
    return {
      ...p,
      ultimoFin: fila?.ultimoFin ?? null,
      ultimoOk: fila?.ultimoOk ?? null,
      ultimoError: fila?.ultimoError ?? null,
      fallasSeguidas: fila?.fallasSeguidas ?? 0,
      corriendo: Boolean(fila?.corriendoDesde),
      /** Nunca corrio, o lleva mas de tres periodos sin terminar una corrida. */
      callado: desdeMinutos === null || desdeMinutos > p.cadaMinutos * 3,
      desdeMinutos,
    };
  });
}
