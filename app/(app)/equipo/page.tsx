import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { cargaDelEquipo } from "@/lib/personal";
import { PageHeader } from "@/components/ui";
import { PanelEquipo } from "./panel";

export const metadata = { title: "Equipo de mantenimiento" };
export const dynamic = "force-dynamic";

/**
 * Cada quien ve lo suyo; supervisores y arriba ven al equipo completo.
 *
 * Que el tecnico vea sus propios numeros vuelve esto una herramienta suya y no
 * un expediente sobre el. De paso, es lo que lo motiva a capturar bien las
 * horas: sin captura honesta, todo lo que se construya encima es humo.
 */
export default async function EquipoPage() {
  const user = await requireUser();
  const veTodo = can(user.role, "workorder:write");

  const datos = await cargaDelEquipo(user.organizationId, {
    soloUserId: veTodo ? null : user.id,
  });

  return (
    <>
      <PageHeader
        title={veTodo ? "Equipo de mantenimiento" : "Mi carga de trabajo"}
        description={
          veTodo
            ? "Cómo está repartido el trabajo, en qué se va el tiempo y qué está trabando la operación."
            : "Lo que trae asignado, las horas que ha aplicado y en qué equipos."
        }
      />
      <PanelEquipo
        datos={JSON.parse(JSON.stringify(datos))}
        veTodo={veTodo}
        conIa={veTodo}
      />
    </>
  );
}
