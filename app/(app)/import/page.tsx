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
    erroresComunes: IMPORTACIONES[clave].erroresComunes ?? [],
    columnas: IMPORTACIONES[clave].columnas,
    // Si un duplicado exacto se puede actualizar, o solo omitir.
    actualizable: Boolean(IMPORTACIONES[clave].actualizar),
  }));

  return (
    <>
      <PageHeader
        title="Importar datos"
        description="Cargue su información desde Excel en vez de capturarla a mano. Cada tipo tiene su plantilla; antes de guardar nada se muestra qué va a pasar con cada renglón, y cada importación se puede revertir."
      />
      <AsistenteImportacion tipos={tipos} />
    </>
  );
}
