import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { generarInventario, prepararEntrevista } from "@/lib/ia/implementacion";
import { logAudit } from "@/lib/audit";

export const maxDuration = 300;

const entrevistar = z.object({
  paso: z.literal("ENTREVISTA"),
  descripcion: z.string().trim().min(15).max(1200),
});

const generar = z.object({
  paso: z.literal("INVENTARIO"),
  descripcion: z.string().trim().min(15).max(1200),
  tipo: z.string().trim().max(40).nullable(),
  respuestas: z.array(z.object({
    pregunta: z.string().trim().min(1).max(300),
    respuesta: z.string().trim().max(400),
  })).max(10),
  equiposVistos: z.array(z.object({
    zona: z.string().trim().max(120),
    equipos: z.array(z.string().trim().max(200)).max(30),
  })).max(20).optional(),
  // Las fotos que ya se analizaron y estan esperando dueño.
  fotoIds: z.array(z.string().min(1)).max(60).optional(),
});

/**
 * Levantamiento de inventario en dos pasos.
 *
 * El primero solo pregunta; el segundo propone y guarda el borrador. Se
 * separan porque las respuestas cambian el resultado por completo, y porque
 * preguntar cuesta una fraccion de lo que cuesta proponer.
 */
export async function POST(request: Request) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La funcion de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const cuerpo = await request.json();
    const org = {
      id: orgId,
      plan: user.organization.plan,
      iaComplemento: user.organization.iaComplemento,
      iaExtra: user.organization.iaExtra,
    };

    try {
      if (cuerpo?.paso === "ENTREVISTA") {
        const input = entrevistar.parse(cuerpo);
        const r = await prepararEntrevista(org, { descripcion: input.descripcion,
          userId: user.id,
          operador: user.isSuperAdmin,
          org: { tipoInstalacion: user.organization.tipoInstalacion, industry: user.organization.industry },
        });
        if (!r.ok) return fail(r.motivo, 402);
        return ok({ entrevista: r.entrevista });
      }

      const input = generar.parse(cuerpo);
      const r = await generarInventario(org, {
        descripcion: input.descripcion,
        tipo: input.tipo,
        respuestas: input.respuestas,
        equiposVistos: input.equiposVistos,
        org: { tipoInstalacion: user.organization.tipoInstalacion, industry: user.organization.industry },
        userId: user.id,
        operador: user.isSuperAdmin,
      });
      if (!r.ok) return fail(r.motivo, 402);

      // El borrador se guarda: la revision puede tomar dos sesiones y la
      // verificacion en piso, varios dias.
      const intake = await prisma.assetIntake.create({
        data: {
          organizationId: orgId,
          createdById: user.id,
          descripcion: input.descripcion,
          tipo: input.tipo,
          entrevista: JSON.stringify(input.respuestas),
          notaIa: r.inventario.nota,
          propuestas: {
            create: r.inventario.sistemas.flatMap((s) =>
              s.activos.map((a) => ({
                sistema: s.nombre,
                nombre: a.nombre,
                categoria: a.categoria,
                criticidad: ["A", "B", "C"].includes(a.criticidad) ? a.criticidad : "C",
                ubicacion: a.ubicacion,
                cantidad: Math.max(1, Math.min(50, Math.round(a.cantidad))),
                porQue: a.porQue,
              })),
            ),
          },
        },
        select: { id: true, _count: { select: { propuestas: true } } },
      });

      // Las fotos del recorrido pasan a colgar del levantamiento. El filtro
      // por organizacion no es adorno: el identificador viene del navegador y
      // sin el se podrian enganchar fotos de otra empresa.
      let fotosEnlazadas = 0;
      if (input.fotoIds?.length) {
        const { count } = await prisma.attachment.updateMany({
          where: { id: { in: input.fotoIds }, organizationId: orgId, assetIntakeId: null },
          data: { assetIntakeId: intake.id },
        });
        fotosEnlazadas = count;
      }

      // Limpieza de fotos que se analizaron y nunca llegaron a un borrador,
      // porque el usuario abandono el asistente a la mitad. Ocupan almacen y
      // no le sirven a nadie. Solo se van las de mas de un dia, para no tocar
      // un levantamiento que alguien este armando en otra pestaña.
      const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.attachment.deleteMany({
        where: {
          organizationId: orgId,
          assetIntakeId: null,
          workOrderId: null, assetId: null, workRequestId: null, partId: null,
          createdAt: { lt: ayer },
        },
      }).catch(() => undefined);

      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "AssetIntake", entityId: intake.id, action: "CREATED",
        summary: `Levantamiento asistido: ${intake._count.propuestas} activos propuestos${fotosEnlazadas ? ` con ${fotosEnlazadas} fotos de evidencia` : ""}`,
      });

      return ok({ intakeId: intake.id, propuestos: intake._count.propuestas, nota: r.inventario.nota, fotos: fotosEnlazadas }, 201);
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible completar el levantamiento", 502);
    }
  });
}
