import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader } from "@/components/ui";
import { datosConsultor } from "@/lib/consultor/consultor";
import { quienDe } from "@/lib/consultor/quien";
import { PanelDelConsultor } from "./panel";

export const metadata = { title: "Consultor del Sistema" };
export const dynamic = "force-dynamic";

export default async function ConsultorPage() {
  const user = await requireUser();
  const ahora = new Date();
  const d = await datosConsultor(quienDe(user), ahora);
  return (
    <>
      <PageHeader
        title="Consultor del Sistema"
        description="Lo acompaña para dejar MainTrack operando y después en el día a día: qué sigue, cómo se hace y por qué algo no funciona. Solo habla del sistema."
      />
      {d.activo ? (
        <PanelDelConsultor
          pasos={d.pasos} porcentaje={d.porcentaje} memoria={d.memoria} mensajes={d.mensajes} quedanHoy={d.quedanHoy} ia={d.ia}
          puedeAdministrar={d.puedeAdministrar} soloLectura={d.soloLectura} ahora={ahora.toISOString()}
        />
      ) : (
        <Card>
          <p className="font-semibold">El Consultor está apagado en esta empresa.</p>
          {d.puedeActivar && can(user.role, "settings:write")
            ? <p className="mt-1 text-sm">Se enciende en <Link className="text-brand-700 underline" href="/settings?s=consultor">Ajustes › Consultor del Sistema</Link>.</p>
            : <p className="mt-1 text-sm text-slate-500">Lo enciende quien administra la empresa, en Ajustes.</p>}
        </Card>
      )}
    </>
  );
}
