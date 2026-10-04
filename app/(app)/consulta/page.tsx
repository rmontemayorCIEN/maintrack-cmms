import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { consumoIa } from "@/lib/ia/consumo";
import { EJEMPLOS } from "@/lib/ia/consulta";
import { PanelConsulta } from "./panel";
import { tieneChatDeVoz } from "@/lib/voz";

export const metadata = { title: "Consulta" };
export const dynamic = "force-dynamic";

export default async function ConsultaPage() {
  const user = await requireUser();
  const entitlement = iaDeLaOrganizacion(user.organization);
  const uso = await consumoIa(user.organizationId);

  return (
    <>
      <PageHeader
        title="Pregunte a sus datos"
        description="Escriba la pregunta como se la haria a su jefe de mantenimiento. El sistema consulta su propia información y responde con las cifras."
      />
      <PanelConsulta
        disponible={iaConfigurada() && entitlement.funciones.includes("BUSQUEDA")}
        restantes={Math.max(0, entitlement.operaciones - uso.operaciones)}
        ejemplos={EJEMPLOS}
        conVoz={tieneChatDeVoz(user.organization.plan)}
      />
    </>
  );
}
