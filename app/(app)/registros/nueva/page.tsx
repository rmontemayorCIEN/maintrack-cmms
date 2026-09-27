import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Armador } from "./armador";

export const metadata = { title: "Armar un registro propio" };

export default async function NuevoRegistroPage() {
  const user = await requireUser();
  if (!user.organization.registrosPropios) {
    // La guardia de rol ya la hizo el layout con lib/pantallas.ts; esto es el
    // contrato, que es otra cosa y se explica distinto.
    return (
      <div>
        <PageHeader title="Armar un registro propio" description="Esta función se contrata aparte." />
        <p className="text-sm text-slate-600">
          «Registros propios» no está activo en su cuenta. Escríbanos desde Soporte y lo activamos.
        </p>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Armar un registro propio"
        description="Una tabla suya, con las columnas que usted decida y amarrada a sus equipos, su personal y sus proveedores."
      />
      <Armador />
    </div>
  );
}
