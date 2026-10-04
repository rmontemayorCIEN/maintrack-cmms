import { prisma } from "@/lib/db";
import { notify } from "@/lib/audit";
/**
 * Los tipos y las constantes viven aparte porque los usa el navegador. Se
 * reexportan desde aqui para que quien ya importaba de este archivo no tenga
 * que cambiar, pero una pantalla de cliente tiene que importar de
 * `comentarios-tipos`, NO de aqui.
 */
import { ANCLAS, MAXIMO_TEXTO, type Ancla, type ComentarioVisible } from "@/lib/comentarios-tipos";
export { ANCLAS, MAXIMO_TEXTO };
export type { Ancla, ComentarioVisible };

/**
 * La conversacion pegada a un registro.
 *
 * ── El problema que resuelve ──
 *
 * Rafael: «se dan muchas interacciones por muchos canales y la mayoria es
 * informacion valiosa que se dispersa». El tecnico pregunta por WhatsApp si la
 * bomba lleva sello 6205 o 6206, alguien contesta, y al mes siguiente nadie
 * encuentra esa respuesta y se vuelve a preguntar.
 *
 * Esto NO es un chat. Es deliberado: un chat dentro de un CMMS compite con
 * WhatsApp y pierde —nadie abandona el grupo donde ya esta su cuadrilla—, y si
 * se usa a medias reproduce la misma dispersion pero ahora tambien adentro. Lo
 * que si gana es que lo dicho quede amarrado al objeto del que se habla.
 *
 * ── Un solo lugar ──
 *
 * Cuatro pantallas lo usan —orden, activo, solicitud, requisicion— y la regla
 * de quien ve que, como se avisa una mencion y como se borra sin dejar hueco
 * vive aqui, una vez. Copiarla en cuatro pantallas era garantizar que se
 * comportaran distinto.
 */


/** La llave de Prisma que corresponde a cada ancla. */
function campoDe(ancla: Ancla): "workOrderId" | "assetId" | "workRequestId" | "materialRequestId" {
  return `${ancla}Id` as never;
}

/**
 * Los comentarios de un registro, del mas viejo al mas nuevo.
 *
 * En orden de conversacion, no al reves: se lee como una platica, y lo ultimo
 * —que es donde uno va a escribir— queda abajo, junto al campo.
 */
export async function listarComentarios(
  organizationId: string,
  ancla: Ancla,
  anclaId: string,
): Promise<ComentarioVisible[]> {
  const filas = await prisma.comentario.findMany({
    where: { organizationId, [campoDe(ancla)]: anclaId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, texto: true, createdAt: true, editadoEl: true, eliminadoEl: true,
      autor: { select: { id: true, name: true, color: true } },
      menciones: { select: { user: { select: { id: true, name: true } } } },
    },
  });

  return filas.map((c) => ({
    id: c.id,
    // Lo borrado no se sirve: marcarlo en la base y mandar el texto de todos
    // modos seria esconderlo solo en la pantalla.
    texto: c.eliminadoEl ? "" : c.texto,
    createdAt: c.createdAt,
    editadoEl: c.editadoEl,
    eliminadoEl: c.eliminadoEl,
    autor: c.autor,
    menciones: c.menciones.map((m) => m.user),
  }));
}

/**
 * Escribir un comentario, y avisarle a quien se nombro.
 *
 * ── Las menciones vienen del cliente como identificadores, no como texto ──
 *
 * La pantalla ofrece un selector y manda ids. Sacar los nombres del texto
 * —buscar «@Ana»— funciona hasta que hay dos Anas, o alguien se llama «Ana
 * Maria», o cambian un nombre en Usuarios. Los ids se validan contra la
 * organizacion antes de guardarse: nombrar a alguien de otra empresa no puede
 * ni empezar.
 *
 * ── El aviso va por `notify`, y despues de guardar ──
 *
 * Por `notify` porque es el unico canal del sistema (CLAUDE.md), y despues de
 * guardar porque si el envio falla el comentario ya quedo escrito. Al reves se
 * pierde lo dicho cuando se cae el canal.
 */
export async function crearComentario(params: {
  organizationId: string;
  autorId: string;
  autorNombre: string;
  ancla: Ancla;
  anclaId: string;
  texto: string;
  menciones?: string[];
  /** A donde lleva el aviso, y como se llama el registro para el titulo. */
  enlace: string;
  comoSeLlama: string;
}): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const texto = params.texto.trim().slice(0, MAXIMO_TEXTO);
  if (!texto) return { ok: false, motivo: "El comentario viene vacío." };

  // Solo gente de ESTA empresa, y activa. La consulta es la validacion: lo que
  // no salga de aqui no se guarda, venga como venga del navegador.
  const mencionados = params.menciones?.length
    ? await prisma.user.findMany({
        where: { id: { in: params.menciones }, organizationId: params.organizationId, active: true },
        select: { id: true },
      })
    : [];

  const comentario = await prisma.comentario.create({
    data: {
      organizationId: params.organizationId,
      autorId: params.autorId,
      texto,
      [campoDe(params.ancla)]: params.anclaId,
      menciones: { create: mencionados.map((u) => ({ userId: u.id })) },
    },
    select: { id: true },
  });

  /**
   * Nombrarse a uno mismo no avisa.
   *
   * Pasa todo el tiempo al escribir «@Juan y yo lo vemos mañana», y recibir un
   * aviso de algo que uno acaba de escribir es la clase de ruido que hace que
   * la gente apague los avisos —y con ellos los que si importaban—.
   */
  for (const u of mencionados) {
    if (u.id === params.autorId) continue;
    await notify({
      organizationId: params.organizationId,
      userId: u.id,
      title: `${params.autorNombre} lo mencionó en ${params.comoSeLlama}`,
      // El propio comentario es el cuerpo: obligar a abrir la pantalla para
      // saber de que se trata convierte un aviso util en una molestia.
      body: texto.slice(0, 200),
      link: params.enlace,
      tipo: "MENCION",
      modulo: "COMENTARIOS",
      entidad: params.ancla,
      entidadId: params.anclaId,
      tag: params.anclaId,
    });
  }

  return { ok: true, id: comentario.id };
}

/**
 * Borrar un comentario propio.
 *
 * Se marca, no se quita. Una conversacion con huecos no se entiende, y el
 * hueco tapa justo lo que alguien quiso tapar. En pantalla queda «comentario
 * eliminado» con su autor y su hora, que es la verdad.
 *
 * Solo el autor. Que un supervisor pueda borrar lo que dijo otro convierte la
 * bitacora en algo que no se puede citar, y entonces no sirve para nada.
 */
export async function eliminarComentario(
  organizationId: string,
  comentarioId: string,
  userId: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const r = await prisma.comentario.updateMany({
    where: { id: comentarioId, organizationId, autorId: userId, eliminadoEl: null },
    data: { eliminadoEl: new Date() },
  });
  if (!r.count) return { ok: false, motivo: "Solo quien lo escribió puede borrarlo." };
  return { ok: true };
}

/**
 * Quien puede comentar un registro: exactamente quien puede VERLO.
 *
 * No hay permiso propio de comentar, y es deliberado. Un permiso aparte deja
 * gente que ve la orden y no puede decir lo que sabe —que es justo lo que se
 * esta tratando de rescatar de WhatsApp—. Y al reves seria peor: comentar un
 * registro que no se puede abrir es una forma de averiguar que existe.
 *
 * Devuelve ademas a donde lleva el aviso y como se llama el registro, porque
 * quien avisa necesita las dos cosas y son las mismas para los cuatro tipos.
 */
export async function registroComentable(
  organizationId: string,
  rol: string,
  ancla: Ancla,
  anclaId: string,
  contexto: { esSuperAdmin?: boolean; esDemo?: boolean } = {},
): Promise<{ ok: true; enlace: string; comoSeLlama: string } | { ok: false; motivo: string }> {
  const { puedeVerRuta } = await import("@/lib/pantallas");

  const donde = {
    workOrder: "/work-orders",
    asset: "/assets",
    workRequest: "/requests",
    materialRequest: "/requisiciones",
  }[ancla];

  if (!puedeVerRuta(rol, donde, contexto)) {
    return { ok: false, motivo: "Esta pantalla no es de su perfil." };
  }

  /**
   * Que el registro sea de SU empresa.
   *
   * Sin esto, un identificador copiado de otra cuenta dejaria escribir —y
   * avisar— dentro de datos ajenos. Es la regla 7 de CLAUDE.md aplicada al
   * caso mas facil de olvidar: el que no consulta datos, solo escribe.
   */
  const suyo = await (async () => {
    const w = { id: anclaId, organizationId };
    if (ancla === "workOrder") {
      const r = await prisma.workOrder.findFirst({ where: w, select: { number: true } });
      return r && { enlace: `/work-orders/${anclaId}`, comoSeLlama: `la orden ${r.number}` };
    }
    if (ancla === "asset") {
      const r = await prisma.asset.findFirst({ where: w, select: { code: true, name: true } });
      return r && { enlace: `/assets/${anclaId}`, comoSeLlama: `el activo ${r.code} ${r.name}`.trim() };
    }
    if (ancla === "workRequest") {
      const r = await prisma.workRequest.findFirst({ where: w, select: { number: true } });
      return r && { enlace: `/requests/${anclaId}`, comoSeLlama: `la solicitud ${r.number}` };
    }
    const r = await prisma.materialRequest.findFirst({ where: w, select: { folio: true } });
    return r && { enlace: `/requisiciones/${anclaId}`, comoSeLlama: `la requisición ${r.folio}` };
  })();

  if (!suyo) return { ok: false, motivo: "Ese registro no existe o no es de su empresa." };
  return { ok: true, ...suyo };
}

/**
 * A quien se puede mencionar: la gente activa de la empresa.
 *
 * No pasa por el endpoint de Usuarios porque ese pide permiso de
 * administrarlos, y para nombrar a alguien no hace falta poder editarlo —un
 * tecnico tiene que poder llamar a su supervisor—. Va solo el nombre: ni
 * correo ni rol ni telefono, que es lo que convertiria una lista para
 * mencionar en un directorio.
 */
export async function genteMencionable(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
