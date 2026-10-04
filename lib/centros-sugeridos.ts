/**
 * Proponer los centros de costo que suele tener una instalacion como la suya.
 *
 * ── Por que ──
 *
 * Quien abre una cuenta casi nunca sabe QUE separar, aunque si sepa sus
 * claves. Y sin centros de costo no sirven ni el costo por centro ni los
 * presupuestos, que cuelgan de ellos.
 *
 * ── La advertencia que no se puede callar ──
 *
 * El centro de costo es **la llave para conciliar con la contabilidad del
 * cliente**. Las claves que se proponen aqui son un punto de partida y hay
 * que cambiarlas por las suyas: si se quedan las inventadas y su contador usa
 * otras, el reporte de costo por centro deja de servir justo para lo que
 * sirve —hablar con finanzas— y eso se descubre meses despues, con historial
 * ya cargado. Por eso la pantalla lo dice y la funcion no las da por buenas.
 *
 * ── Lo que NO hace ──
 *
 * No pisa nada. Un centro que ya exista con esa clave se respeta tal cual: la
 * propuesta es para arrancar, no para reescribir lo que alguien ya capturo.
 */
import { prisma } from "./db";
import { instalacionDe } from "./instalaciones";

export type CentroSugerido = { code: string; name: string; descripcion: string };

/** Lo que se propondria para ese tipo de instalacion. Sin tocar la base. */
export function centrosSugeridos(tipoInstalacion?: string | null): CentroSugerido[] {
  return [...instalacionDe(tipoInstalacion).centrosSugeridos];
}

/**
 * Da de alta los que falten. Devuelve que se creo y que ya existia.
 *
 * Se compara por CLAVE, que es lo unico unico por empresa. Dos centros
 * llamados «Climatizacion» con claves distintas son dos centros distintos:
 * puede ser correcto —una plaza con dos edificios— y no nos toca decidirlo.
 */
export async function aplicarCentrosSugeridos(params: {
  organizationId: string;
  tipoInstalacion?: string | null;
}): Promise<{ creados: CentroSugerido[]; yaExistian: string[] }> {
  const propuestos = centrosSugeridos(params.tipoInstalacion);
  const existentes = new Set(
    (await prisma.centroDeCosto.findMany({
      where: { organizationId: params.organizationId },
      select: { code: true },
    })).map((c) => c.code),
  );

  const nuevos = propuestos.filter((c) => !existentes.has(c.code));
  if (nuevos.length) {
    await prisma.centroDeCosto.createMany({
      data: nuevos.map((c) => ({
        organizationId: params.organizationId,
        code: c.code,
        name: c.name,
        descripcion: c.descripcion,
      })),
    });
  }

  return {
    creados: nuevos,
    yaExistian: propuestos.filter((c) => existentes.has(c.code)).map((c) => c.code),
  };
}
