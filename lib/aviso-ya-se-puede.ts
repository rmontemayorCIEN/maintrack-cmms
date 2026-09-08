import { prisma } from "./db";
import { notify } from "./audit";
import { backlog, type ItemBacklog } from "./backlog";

/**
 * Avisar que un trabajo trabado YA SE PUEDE hacer.
 *
 * Esta es la espera cara del sistema. Una actividad se libero porque no habia
 * la refaccion; semanas despues la refaccion llega al almacen y el dato queda
 * ahi, correcto y completo, sin que nadie lo vea. El diagnostico las encuentra
 * en segundos —la mediana llevaba diez dias esperando— pero encontrarlas no
 * sirve si nadie las mira.
 *
 * No inventa nada: `backlog()` ya calcula `yaSePuede`, incluidas las
 * equivalencias —el balero de otra marca que si esta en el almacen. Lo unico
 * que faltaba era decirselo a alguien.
 *
 * ── Por que un barrido y no un enganche al movimiento de almacen ──
 *
 * La existencia cambia en once lugares, y varios corren dentro de una
 * transaccion mayor: recepcion de compra, traspaso, conteo fisico, consumo,
 * importacion. Avisar dentro de la transaccion seria mentir —si se revierte,
 * el aviso ya salio— y avisar en cada uno de los once seria repetir la misma
 * logica once veces y que se desincronicen.
 *
 * El barrido es un solo lugar y cubre TODOS los caminos, incluidos los que
 * todavia no existen. Y la inmediatez no vale nada aqui: se esta recortando
 * una espera de dias, no de minutos.
 */

/** Cuantos equipos se nombran en el aviso antes de resumir. */
const EQUIPOS_EN_EL_AVISO = 3;

export type ResumenAviso = {
  /** Actividades que pasaron a poderse hacer y por las que se aviso. */
  avisadas: number;
  /** A cuantas personas se les dijo. */
  personas: number;
  /** Actividades cuya refaccion se volvio a acabar: se limpia la memoria. */
  revertidas: number;
};

/** El texto del aviso. Aparte, para poder probarlo sin base de datos. */
export function redactarAviso(items: ItemBacklog[]): { title: string; body: string } {
  if (items.length === 1) {
    const t = items[0];
    const equipo = t.workOrder.asset ? `${t.workOrder.asset.code} · ${t.workOrder.asset.name}` : "Sin equipo";
    const refaccion = t.bloqueadaPor?.name;
    // Se nombra la equivalente cuando la original sigue sin llegar: el tecnico
    // tiene que saber que va a tomar otra cosa del almacen, no la que pidio.
    const conQue = t.conEquivalente
      ? ` Con la equivalente ${t.conEquivalente.refaccion.code} (${t.conEquivalente.refaccion.name}).`
      : refaccion
        ? ` Ya hay ${refaccion} en el almacén.`
        : "";
    return {
      title: `Ya se puede: ${t.title}`,
      body: `${equipo}.${conQue} Llevaba ${t.diasEsperando} día${t.diasEsperando === 1 ? "" : "s"} esperando.`,
    };
  }

  const equipos = [...new Set(items.map((t) => t.workOrder.asset?.code).filter(Boolean))];
  const nombrados = equipos.slice(0, EQUIPOS_EN_EL_AVISO).join(", ");
  const resto = equipos.length - EQUIPOS_EN_EL_AVISO;
  const masDias = Math.max(...items.map((t) => t.diasEsperando));

  return {
    title: `Ya se pueden hacer ${items.length} actividades`,
    body: `Estaban esperando refacción${equipos.length ? ` en ${nombrados}${resto > 0 ? ` y ${resto} equipo${resto === 1 ? "" : "s"} más` : ""}` : ""}. La más vieja lleva ${masDias} día${masDias === 1 ? "" : "s"}.`,
  };
}

/**
 * Revisa el backlog de una organizacion y avisa lo que cambio.
 *
 * Solo avisa en el CAMBIO de "no se puede" a "si se puede". Mientras el estado
 * se mantiene no repite nada: un aviso que llega todos los dias diciendo lo
 * mismo se vuelve ruido y la gente deja de leerlo, incluido el dia que si
 * importaba.
 */
export async function avisarTrabajoDisponible(organizationId: string): Promise<ResumenAviso> {
  const items = await backlog(organizationId);

  /**
   * La refaccion se volvio a acabar: se olvida el aviso.
   *
   * Sin esto, una actividad que se pudo hacer un dia y se volvio a trabar
   * nunca vuelve a avisar, aunque llegue material otra vez. Con esto, el aviso
   * sale de nuevo en el siguiente cambio.
   */
  const revertidas = items
    .filter((t) => t.yaSePuede === false && t.avisoDisponibleAt !== null)
    .map((t) => t.id);
  if (revertidas.length) {
    await prisma.workOrderTask.updateMany({
      where: { id: { in: revertidas } },
      data: { avisoDisponibleAt: null },
    });
  }

  const nuevas = items.filter((t) => t.yaSePuede === true && t.avisoDisponibleAt === null);
  if (!nuevas.length) return { avisadas: 0, personas: 0, revertidas: revertidas.length };

  /**
   * A quien se le dice.
   *
   * A quien la libero, porque es su trabajo pendiente y sabe de que se trata.
   * Y a quien puede reprogramarla, porque el tecnico no se agenda solo: si el
   * aviso llega unicamente a quien no puede actuar, la espera sigue igual.
   */
  const quienesReprograman = await prisma.user.findMany({
    where: { organizationId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR"] } },
    select: { id: true },
  });

  const porPersona = new Map<string, ItemBacklog[]>();
  for (const item of nuevas) {
    const destinatarios = new Set<string>(quienesReprograman.map((u) => u.id));
    if (item.liberadaPorId) destinatarios.add(item.liberadaPorId);
    for (const userId of destinatarios) {
      const suyas = porPersona.get(userId) ?? [];
      suyas.push(item);
      porPersona.set(userId, suyas);
    }
  }

  // Sin nadie a quien decirle no se marca nada: el dia que exista un
  // supervisor, se entera. Marcarlo ahora seria enterrar el aviso para siempre.
  if (!porPersona.size) return { avisadas: 0, personas: 0, revertidas: revertidas.length };

  for (const [userId, suyas] of porPersona) {
    const { title, body } = redactarAviso(suyas);
    await notify({
      organizationId,
      userId,
      title,
      body,
      link: "/backlog",
      // No lleva agrupador a proposito: cada barrido informa de actividades
      // distintas, y reemplazar el aviso anterior taparia trabajo que la
      // persona todavia no habia visto.
    });
  }

  await prisma.workOrderTask.updateMany({
    where: { id: { in: nuevas.map((t) => t.id) } },
    data: { avisoDisponibleAt: new Date() },
  });

  return { avisadas: nuevas.length, personas: porPersona.size, revertidas: revertidas.length };
}
