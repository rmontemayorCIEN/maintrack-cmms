import { z } from "zod";
import { veTodasLasSolicitudes } from "@/lib/pantallas";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { can } from "@/lib/rbac";
import { verificarCupo } from "@/lib/planes";
import {
  TAMANO_MAXIMO_MB, TIPOS_PERMITIDOS, clasificar, construirRuta,
  borrarArchivo, urlDeSubida, verificarSubida,
} from "@/lib/almacenamiento";
import { logAudit } from "@/lib/audit";

/** A que registro se adjunta. Exactamente uno debe venir. */
const destino = z.object({
  workOrderId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  workRequestId: z.string().optional().nullable(),
  partId: z.string().optional().nullable(),
  rondinParadaId: z.string().optional().nullable(),
  normaId: z.string().optional().nullable(),
});

const solicitud = destino.extend({
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  size: z.coerce.number().int().positive(),
});

/**
 * Permiso necesario segun a que se adjunta.
 *
 * Adjuntar a una solicitud de servicio exige solo `request:create`, porque
 * quien reporta una falla suele ser un operador con rol Solicitante — y es
 * precisamente quien tiene la foto del sintoma delante. Exigirle el permiso de
 * ejecucion lo dejaria fuera de lo unico que puede aportar.
 */
function permisoDe(d: z.infer<typeof destino>) {
  if (d.workRequestId) return "request:create";
  // Colgar la publicacion oficial de una norma es parte de administrarla:
  // mismo permiso que el resto de sus rutas, no el de ejecutar trabajo.
  if (d.normaId) return "settings:write";
  return "workorder:execute";
}

function contextoDe(d: z.infer<typeof destino>) {
  if (d.workOrderId) return { carpeta: "ordenes", clave: "workOrderId" as const, id: d.workOrderId };
  if (d.assetId) return { carpeta: "activos", clave: "assetId" as const, id: d.assetId };
  if (d.workRequestId) return { carpeta: "solicitudes", clave: "workRequestId" as const, id: d.workRequestId };
  if (d.partId) return { carpeta: "refacciones", clave: "partId" as const, id: d.partId };
  if (d.rondinParadaId) return { carpeta: "rondines", clave: "rondinParadaId" as const, id: d.rondinParadaId };
  if (d.normaId) return { carpeta: "normas", clave: "normaId" as const, id: d.normaId };
  return null;
}

/**
 * Quien solo ve sus propias solicitudes (solicitante, técnico) solo les cuelga
 * archivos a ellas. Sin esto, con el identificador de una solicitud ajena
 * se podía agregarle fotos.
 */
async function puedeAdjuntarA(user: { id: string; role: string }, orgId: string, d: z.infer<typeof destino>) {
  if (!d.workRequestId || veTodasLasSolicitudes(user.role)) return true;
  return (await prisma.workRequest.count({ where: { id: d.workRequestId, organizationId: orgId, requestedById: user.id } })) > 0;
}

/**
 * Paso 1: pide permiso para subir.
 * Devuelve una URL firmada contra la que el navegador sube DIRECTO al almacen,
 * sin que el archivo pase por el servidor.
 */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const input = solicitud.parse(await request.json());

    const ctx = contextoDe(input);
    if (!ctx) return fail("Falta indicar a que registro se adjunta el archivo", 422);
    if (!can(user.role, permisoDe(input))) return fail("Sin permisos suficientes", 403);

    if (!TIPOS_PERMITIDOS.includes(input.mimeType)) {
      return fail(`No se admiten archivos de tipo ${input.mimeType}`, 415);
    }
    if (input.size > TAMANO_MAXIMO_MB * 1_048_576) {
      return fail(`El archivo supera el maximo de ${TAMANO_MAXIMO_MB} MB`, 413);
    }

    const cupo = await verificarCupo(orgId, user.organization.plan, "storageGb");
    if (!cupo.permitido) return fail(cupo.mensaje, 402);

    // El registro destino debe existir y pertenecer a esta organizacion: sin
    // esto se podrian colgar archivos de registros de otro cliente.
    const tablas = {
      workOrderId: prisma.workOrder, assetId: prisma.asset,
      workRequestId: prisma.workRequest, partId: prisma.part,
      rondinParadaId: prisma.rondinParada, normaId: prisma.normaAdoptada,
    };
    const existe = await (tablas[ctx.clave] as { findFirst: Function }).findFirst({
      where: { id: ctx.id, organizationId: orgId },
      select: { id: true },
    });
    if (!existe) return fail("El registro al que quiere adjuntar no existe", 404);
    if (!(await puedeAdjuntarA(user, orgId, input))) return fail("El registro al que quiere adjuntar no existe", 404);

    const storagePath = construirRuta(orgId, ctx.carpeta, input.name);
    const subida = await urlDeSubida(storagePath, input.mimeType);

    return ok({ storagePath, url: subida.url, metodo: subida.metodo });
  });
}

const confirmacion = solicitud.extend({
  storagePath: z.string().min(1),
  note: z.string().max(300).optional().nullable(),
  /// Lo trajo la asistencia con IA. Se guarda para que la pantalla lo advierta.
  origenIa: z.boolean().optional(),
});

/**
 * Paso 2: confirma que la subida termino y registra el adjunto.
 * Se comprueba contra el almacen que el archivo exista de verdad; asi un
 * cliente no puede inventar registros de archivos que nunca subio.
 */
export async function PUT(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const input = confirmacion.parse(await request.json());
    if (!can(user.role, permisoDe(input))) return fail("Sin permisos suficientes", 403);

    if (!input.storagePath.startsWith(`org-${orgId}/`)) {
      return fail("Ruta de almacenamiento invalida", 403);
    }

    const tamanoReal = await verificarSubida(input.storagePath);
    if (tamanoReal === null) {
      return fail("El archivo no llego al almacén. Intente subirlo de nuevo.", 409);
    }

    /**
     * Lo que se valida arriba es el tamano DECLARADO por el navegador; esto
     * es el real.
     *
     * Sin esta comprobacion, declarar un mega para obtener la URL firmada y
     * subir cinco gigas funcionaba: el archivo quedaba en el almacen, se
     * cobraba, y el cupo del plan se rebasaba despues del hecho. Si no cabe,
     * se borra del almacen y no se registra: dejarlo ahi seria pagar por un
     * archivo que nadie puede ver.
     */
    if (tamanoReal > TAMANO_MAXIMO_MB * 1_048_576) {
      await borrarArchivo(input.storagePath).catch(() => undefined);
      return fail(`El archivo pesa ${Math.round(tamanoReal / 1_048_576)} MB y el máximo son ${TAMANO_MAXIMO_MB} MB. No se guardó.`, 413);
    }
    // El cupo se vuelve a revisar con el peso real, por la misma razon.
    const cupoReal = await verificarCupo(orgId, user.organization.plan, "storageGb", 1, tamanoReal);
    if (!cupoReal.permitido) {
      await borrarArchivo(input.storagePath).catch(() => undefined);
      return fail(cupoReal.mensaje, 402);
    }

    const ctx = contextoDe(input);
    if (!ctx) return fail("Falta indicar a que registro se adjunta", 422);
    if (!(await puedeAdjuntarA(user, orgId, input))) return fail("El registro al que quiere adjuntar no existe", 404);

    const adjunto = await prisma.attachment.create({
      data: {
        organizationId: orgId,
        uploadedById: user.id,
        name: input.name,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        kind: clasificar(input.mimeType),
        size: tamanoReal,
        note: input.note ?? null,
        origenIa: input.origenIa ?? false,
        [ctx.clave]: ctx.id,
      },
      select: { id: true, name: true, kind: true, size: true, origenIa: true, createdAt: true },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Attachment", entityId: adjunto.id,
      action: "UPLOADED", summary: `${input.name} adjuntado a ${ctx.carpeta}`,
    });

    return ok({ attachment: adjunto }, 201);
  });
}
