import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { armarPresentacion } from "@/lib/demo-presentacion";
import { Presentacion } from "@/components/demo/presentacion";
import { ligasDeHistorias } from "../ligas";

export const metadata = { title: "Presentación" };

/**
 * La presentación al cliente, a pantalla completa.
 *
 * Vive dentro de la empresa demostrativa a propósito: los botones de cada
 * caso abren la pantalla real con los datos de la demo, que es lo que la hace
 * distinta de un archivo de diapositivas.
 */
export default async function PresentacionPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const user = await getCurrentUser();
  if (!user?.organization.esDemo) notFound();

  const ligas = await ligasDeHistorias(user.organizationId, user.role);
  const diapositivas = armarPresentacion(ligas);
  const d = Number.parseInt((await searchParams).d ?? "1", 10);
  const inicial = Number.isFinite(d) ? d - 1 : 0;

  return <Presentacion diapositivas={diapositivas} inicial={inicial} />;
}
