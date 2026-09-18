import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { CentroDeAvisos } from "./centro";

export const metadata = { title: "Avisos" };
export const dynamic = "force-dynamic";

export default async function NotificacionesPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Avisos"
        description="Todo lo que el sistema le ha dicho. Leer un aviso no lo atiende: los que piden acción siguen pendientes hasta que se resuelve lo que los originó."
      />
      <CentroDeAvisos />
    </>
  );
}
