import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { IMPORTACIONES, ORDEN_IMPORTACION } from "@/lib/importacion";
import { PageHeader } from "@/components/ui";
import { AsistenteImportacion } from "./asistente";

export const metadata = { title: "Importar datos" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requireUser();
  if (!can(user.role, "settings:write")) redirect("/settings");

  const tipos = ORDEN_IMPORTACION.map((clave) => ({
    clave,
    titulo: IMPORTACIONES[clave].titulo,
    descripcion: IMPORTACIONES[clave].descripcion,
    requisitos: IMPORTACIONES[clave].requisitos ?? null,
    columnas: IMPORTACIONES[clave].columnas,
  }));

  return (
    <>
      <PageHeader
        title="Importar datos"
        description="Cargue su información desde Excel en vez de capturarla a mano. Cada tipo tiene su plantilla, y antes de guardar nada se muestra exactamente que va a pasar."
      />
      <AsistenteImportacion tipos={tipos} />
    </>
  );
}
