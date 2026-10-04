import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ArmadorDeNorma } from "./armador";

export const metadata = { title: "Agregar una norma propia" };

export default async function NuevaNormaPage() {
  const user = await requireUser();
  if (!user.organization.cumplimientoNormas) notFound();

  return (
    <div>
      <PageHeader
        title="Agregar una norma propia"
        description="Un requisito que no está en el catálogo: el estándar de su corporativo, lo que pide su cliente, o una norma que todavía no hemos incluido."
      />
      <ArmadorDeNorma />
    </div>
  );
}
