import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Una refacción no tiene pantalla propia: se consulta en el inventario. Esta
 * dirección existe para que las ligas a una refacción concreta —avisos,
 * resúmenes, pendientes de la puesta en marcha— lleguen a la lista ya
 * filtrada por su código en vez de a un «página no encontrada».
 *
 * Solo dentro de la empresa de la sesión: una refacción de otra da 404.
 */
export default async function RefaccionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const parte = await prisma.part.findFirst({ where: { id, organizationId: user.organizationId }, select: { code: true } });
  if (!parte) notFound();
  redirect(`/inventory?q=${encodeURIComponent(parte.code)}`);
}
