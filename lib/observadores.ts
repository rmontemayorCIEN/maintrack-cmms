import { prisma } from "@/lib/db";

/**
 * «Avíseme lo que pase con esta orden.»
 *
 * ── Por que hacia falta ──
 *
 * Hoy eso se resuelve pidiendole a alguien «me avisas», y ese es exactamente
 * el compromiso que se queda en el aire: quien lo prometio se acuerda dos
 * dias, y quien lo pidio se entera cuando ya no servia.
 *
 * ── Por que se engancha en UN solo lugar ──
 *
 * `emitirAviso` es por donde sale todo aviso del sistema, y ya recibe la
 * entidad y su identificador para CUALQUIER tipo de registro. Resolviendo los
 * observadores ahi, quedan cubiertos todos los tipos de evento de golpe —los
 * que existen hoy y los que se agreguen— sin tocar ni uno.
 *
 * ── Copia, no respaldo ──
 *
 * La cadena de destinatarios funciona al reves: «el primer grupo que tenga a
 * alguien recibe». Un observador NO puede entrar ahi, porque entonces solo se
 * enteraria cuando no hubiera responsable. Se suma aparte, siempre.
 */

/** No se avisa dos veces a la misma persona por ser observador y responsable. */
export async function observadoresDe(
  organizationId: string,
  entidad: string | undefined,
  entidadId: string | undefined,
  yaAvisados: string[],
): Promise<string[]> {
  if (!entidad || !entidadId) return [];
  try {
    const filas = await prisma.observador.findMany({
      where: { organizationId, entidad, entidadId },
      select: { userId: true, user: { select: { active: true } } },
    });
    const ya = new Set(yaAvisados);
    return filas
      // Quien se fue de la empresa no recibe: su usuario sigue, su aviso no.
      .filter((o) => o.user?.active && !ya.has(o.userId))
      .map((o) => o.userId);
  } catch {
    /**
     * Si esto falla, el aviso original SIGUE saliendo.
     *
     * Observar es una comodidad; avisarle al responsable es la funcion. Que
     * una consulta de mas tumbe el aviso principal seria cambiar algo
     * importante por algo accesorio.
     */
    return [];
  }
}

/** Si esta persona ya observa este registro. */
export async function observa(
  organizationId: string, userId: string, entidad: string, entidadId: string,
): Promise<boolean> {
  const n = await prisma.observador.count({ where: { organizationId, userId, entidad, entidadId } });
  return n > 0;
}

/** Empezar o dejar de observar. Devuelve como quedo. */
export async function alternarObservador(
  organizationId: string, userId: string, entidad: string, entidadId: string,
): Promise<{ observa: boolean }> {
  const existente = await prisma.observador.findFirst({
    where: { organizationId, userId, entidad, entidadId }, select: { id: true },
  });
  if (existente) {
    await prisma.observador.delete({ where: { id: existente.id } });
    return { observa: false };
  }
  await prisma.observador.create({ data: { organizationId, userId, entidad, entidadId } });
  return { observa: true };
}

/** Cuantos observan un registro. Para decirlo en pantalla sin listar a nadie. */
export async function cuantosObservan(
  organizationId: string, entidad: string, entidadId: string,
): Promise<number> {
  return prisma.observador.count({ where: { organizationId, entidad, entidadId } });
}
