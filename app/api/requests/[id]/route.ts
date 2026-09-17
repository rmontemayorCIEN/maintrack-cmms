import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { aprobarSolicitud, ErrorDeSolicitud, rechazarSolicitud } from "@/lib/solicitudes";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reviewNotes: z.string().optional(),
  assignedToId: z.string().optional().nullable(),
  /**
   * El equipo, puesto por quien revisa.
   *
   * Un reporte puede llegar sin equipo y es lo normal: el QR del area no lo
   * trae, y a quien reporta desde su celular no se le exige adivinar la clave.
   * Quien SI conoce el catalogo es el gestor, y hasta hoy no tenia donde
   * ponerlo: la solicitud se convertia en una orden sin activo, para siempre.
   * Esa orden no entra al historial de ningun equipo, no cuenta en su Pareto
   * y no suma a su costo de paro. Se veia bien y desaparecia del expediente.
   */
  assetId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  /**
   * OT existente a la que se suma el reporte, en vez de abrir una nueva.
   *
   * Es el caso real: el tecnico ya va a esa bomba por el preventivo del mes,
   * asi que la fuga reportada se atiende en el mismo viaje. El reporte entra
   * como una actividad mas, con su propio tipo, no como orden aparte.
   */
  workOrderId: z.string().optional().nullable(),
  /** Como lo clasifico quien reviso: FALLA | MEJORA | APOYO | OTRO. */
  tipo: z.enum(["FALLA", "MEJORA", "APOYO", "OTRO"]).optional(),
});

/** Aprobar una solicitud la convierte en orden de trabajo correctiva. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("request:review", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    try {
      if (input.action === "REJECT") {
        const updated = await rechazarSolicitud({
          organizationId: orgId,
          userId: user.id,
          solicitudId: id,
          motivo: input.reviewNotes ?? "",
        });
        return ok({ request: updated });
      }
    } catch (e) {
      if (e instanceof ErrorDeSolicitud) return fail(e.message, e.codigo);
      throw e;
    }

    /**
     * El reporte se atiende como ACTIVIDAD, no como encabezado.
     *
     * Antes la conversion creaba una OT vacia, sin una sola actividad, y el
     * codigo de falla se capturaba arriba. Eso impedia que una misma orden
     * atendiera dos reportes: un encabezado no puede tener dos causas. Ahora
     * cada reporte entra como su propia actividad, con su origen y su tipo, y
     * al cerrar se le pregunta su causa por separado.
     */
    try {
      const resultado = await aprobarSolicitud({
        organizationId: orgId,
        userId: user.id,
        solicitudId: id,
        assetId: input.assetId,
        tipo: input.tipo,
        assignedToId: input.assignedToId,
        dueDate: input.dueDate,
        reviewNotes: input.reviewNotes,
        workOrderId: input.workOrderId,
      });
      return ok(resultado, 201);
    } catch (e) {
      if (e instanceof ErrorDeSolicitud) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
