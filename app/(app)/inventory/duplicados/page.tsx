import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader } from "@/components/ui";
import { candidatosDuplicados } from "@/lib/dedupe-refacciones";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { PanelDuplicados } from "./panel";

export const metadata = { title: "Limpieza del catálogo" };
export const dynamic = "force-dynamic";

export default async function DuplicadosPage() {
  const user = await requireUser();
  const candidatos = await candidatosDuplicados(user.organizationId);
  const disponible =
    iaConfigurada() && (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("DEDUPE"));

  return (
    <>
      <PageHeader
        title="Limpieza del catálogo"
        description="Refacciones que parecen ser la misma capturada varias veces. Es el desorden que hace que los mínimos no disparen y que el técnico pida una y el almacenista surta otra."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacén
          </Link>
        }
      />

      {candidatos.length === 0 ? (
        <EmptyState
          title="El catálogo está limpio"
          description="No se encontraron refacciones que parezcan duplicadas. Vale la pena volver a revisar después de importar datos o de un levantamiento."
        />
      ) : (
        <PanelDuplicados
          candidatos={candidatos}
          moneda={user.organization.currency}
          disponible={disponible}
          editable={can(user.role, "inventory:write")}
        />
      )}
    </>
  );
}
