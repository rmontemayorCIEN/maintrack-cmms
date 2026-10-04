/**
 * El aviso de que se abrio trabajo sobre algo que todavia esta cubierto.
 *
 * Vive en `lib/avisos/` y no en `lib/vigencias.ts` para no meterle a ese
 * modulo la dependencia del emisor: las vigencias las lee tambien la
 * pantalla, y el emisor arrastra la cola de entregas completa.
 */
import { prisma } from "../db";
import { emitirAviso } from "./emitir";

export async function avisarGarantiaEnOrden(
  organizationId: string,
  workOrderId: string,
  garantia: { texto: string; vigenciaId: string; hasta: Date | null; proveedor: string | null },
) {
  const o = await prisma.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    select: { id: true, number: true, title: true, assignedToId: true, siteId: true, createdById: true, asset: { select: { code: true, name: true } } },
  });
  if (!o) return;
  await emitirAviso({
    organizationId,
    tipo: "GARANTIA_EN_ORDEN",
    // Cuelga de la ORDEN, no de la vigencia: es de esta orden de lo que se
    // habla, y es a la orden a donde tiene que llevar el enlace.
    entidad: "WorkOrder", entidadId: o.id,
    titulo: `${o.number}: el equipo está en garantía`,
    cuerpo: `${o.asset ? `${o.asset.code} · ${o.asset.name}. ` : ""}${garantia.texto}`,
    porQue:
      "Repararlo con gente y refacciones propias es pagar lo que el proveedor ya cubrió, "
      + "y en algunos contratos abrirlo sin avisar cancela la garantía.",
    accion: garantia.proveedor
      ? `Antes de empezar, confirme con ${garantia.proveedor} si le toca a él.`
      : "Antes de empezar, revise el documento de la garantía y a quién se le reclama.",
    enlace: `/work-orders/${o.id}`,
    contexto: { responsableId: o.assignedToId, solicitanteId: o.createdById, siteId: o.siteId },
    datos: { vigenciaId: garantia.vigenciaId, hasta: garantia.hasta?.toISOString() ?? null, proveedor: garantia.proveedor },
  });
}
