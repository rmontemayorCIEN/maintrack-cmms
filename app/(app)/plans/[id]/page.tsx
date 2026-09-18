import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Un plan no tiene pantalla propia: se abre desde la lista de planes. Esta
 * dirección existe para que las ligas a un plan concreto —avisos, pendientes
 * de la puesta en marcha— lleguen a la lista filtrada por su nombre en vez de
 * a un «página no encontrada».
 *
 * Solo dentro de la empresa de la sesión: un plan de otra da 404.
 */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const plan = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: user.organizationId }, select: { name: true } });
  if (!plan) notFound();
  redirect(`/plans?q=${encodeURIComponent(plan.name)}`);
}
