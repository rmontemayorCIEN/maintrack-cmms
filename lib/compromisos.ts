import { prisma } from "@/lib/db";
import { notify } from "@/lib/audit";


/**
 * Lo que alguien se comprometio a hacer y no cabe en una orden de trabajo.
 *
 * ── Que es ──
 *
 * «Cotiza el motor con tres proveedores», «habla con seguridad por el
 * permiso», «manda el reporte al corporativo». Salen de una conversacion sobre
 * una orden o un activo, no tienen activo propio ni falla ni refacciones, y
 * hoy no tienen donde vivir: se quedan en el aire, que es la mitad del
 * problema que Rafael describio.
 *
 * ── Lo que NO es, y es lo mas importante de este archivo ──
 *
 * NO es un sistema de tareas. Una orden de trabajo ya es una tarea con
 * responsable, fecha, estado y avance; construir otro al lado crea dos lugares
 * donde vive «lo que tengo que hacer», y entonces ninguna de las dos listas es
 * confiable.
 *
 * Por eso esto es a proposito lo mas chico posible: un texto, un responsable,
 * una fecha y tres estados. Sin avance en porcentaje, sin subtareas, sin
 * dependencias. El dia que necesite eso, lo que hacia falta era una orden.
 *
 * Y nace SIEMPRE colgado de un registro. Un compromiso suelto se pierde igual
 * que el mensaje que venia a sustituir.
 */

export const ESTADOS_COMPROMISO = ["ABIERTO", "HECHO", "CANCELADO"] as const;
export type EstadoCompromiso = (typeof ESTADOS_COMPROMISO)[number];

export const MAXIMO_TEXTO_COMPROMISO = 300;

export async function listarCompromisos(organizationId: string, entidad: string, entidadId: string) {
  return prisma.compromiso.findMany({
    where: { organizationId, entidad, entidadId },
    // Lo abierto primero y lo mas proximo arriba: es una lista para actuar,
    // no un historial.
    orderBy: [{ estado: "asc" }, { paraCuando: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, texto: true, estado: true, paraCuando: true, createdAt: true, cerradoEl: true,
      responsable: { select: { id: true, name: true } },
      creadoPor: { select: { id: true, name: true } },
    },
  });
}

/**
 * Anotar un compromiso, y avisarle a quien le toca.
 *
 * El aviso es la mitad del valor: un compromiso que el responsable no sabe que
 * tiene es exactamente lo mismo que el mensaje que se quedo en el aire.
 */
export async function crearCompromiso(params: {
  organizationId: string;
  creadoPorId: string;
  creadoPorNombre: string;
  entidad: string;
  entidadId: string;
  texto: string;
  responsableId?: string | null;
  paraCuando?: Date | null;
  enlace: string;
  comoSeLlama: string;
}): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const texto = params.texto.trim().slice(0, MAXIMO_TEXTO_COMPROMISO);
  if (!texto) return { ok: false, motivo: "El compromiso viene vacío." };

  // El responsable, de ESTA empresa y activo. Igual que en las menciones: la
  // consulta es la validacion.
  const responsable = params.responsableId
    ? await prisma.user.findFirst({
        where: { id: params.responsableId, organizationId: params.organizationId, active: true },
        select: { id: true },
      })
    : null;

  const c = await prisma.compromiso.create({
    data: {
      organizationId: params.organizationId,
      creadoPorId: params.creadoPorId,
      responsableId: responsable?.id ?? null,
      texto,
      paraCuando: params.paraCuando ?? null,
      entidad: params.entidad,
      entidadId: params.entidadId,
    },
    select: { id: true },
  });

  // Apuntarse algo a uno mismo no se avisa: uno acaba de escribirlo.
  if (responsable && responsable.id !== params.creadoPorId) {
    await notify({
      organizationId: params.organizationId,
      userId: responsable.id,
      title: `${params.creadoPorNombre} le dejó un compromiso en ${params.comoSeLlama}`,
      body: texto,
      link: params.enlace,
      tipo: "COMPROMISO_ASIGNADO",
      modulo: "COMENTARIOS",
      /**
       * La entidad es el COMPROMISO, no el registro donde vive.
       *
       * Es lo que le permite a la regla de ciclo de vida encontrarlo y
       * cerrarlo cuando se marca hecho. Agrupado por el registro (`tag`), para
       * que tres compromisos de la misma orden no apilen tres avisos sueltos
       * en el teléfono.
       */
      entidad: "Compromiso",
      entidadId: c.id,
      requiereAccion: true,
      tag: params.entidadId,
    });
  }

  return { ok: true, id: c.id };
}

/**
 * Marcarlo hecho o cancelado, o reabrirlo.
 *
 * Puede el responsable y puede quien lo anoto. Los dos tienen razon para
 * cerrarlo —uno porque lo hizo, el otro porque ya no hace falta— y exigir que
 * sea solo uno deja compromisos abiertos para siempre esperando a alguien que
 * ya no trabaja en eso.
 */
export async function cambiarEstadoCompromiso(
  organizationId: string, id: string, userId: string, estado: EstadoCompromiso,
): Promise<{ ok: boolean; motivo?: string }> {
  const r = await prisma.compromiso.updateMany({
    where: { id, organizationId, OR: [{ responsableId: userId }, { creadoPorId: userId }] },
    data: { estado, cerradoEl: estado === "ABIERTO" ? null : new Date() },
  });
  if (!r.count) return { ok: false, motivo: "Solo su responsable o quien lo anotó puede cambiarlo." };
  return { ok: true };
}

/**
 * Los compromisos abiertos de una persona, para su bandeja.
 *
 * Que aparezcan donde ya mira su trabajo es lo unico que impide que esto se
 * vuelva una segunda lista de pendientes que nadie abre.
 */
export async function misCompromisos(organizationId: string, userId: string) {
  return prisma.compromiso.findMany({
    where: { organizationId, responsableId: userId, estado: "ABIERTO" },
    orderBy: [{ paraCuando: "asc" }, { createdAt: "asc" }],
    take: 20,
    select: {
      id: true, texto: true, paraCuando: true, entidad: true, entidadId: true,
      creadoPor: { select: { name: true } },
    },
  });
}
