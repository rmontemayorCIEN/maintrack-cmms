import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { puestaEnMarcha } from "@/lib/puesta-en-marcha";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { instalacionDe } from "@/lib/instalaciones";
import { PanelPuestaEnMarcha } from "./panel";

export const metadata = { title: "Puesta en marcha" };
export const dynamic = "force-dynamic";

export default async function PuestaEnMarchaPage() {
  const user = await requireUser();
  const [marcha, familias] = await Promise.all([
    puestaEnMarcha(user.organizationId, { conSalud: true }),
    prisma.partCategory.count({ where: { organizationId: user.organizationId } }),
  ]);

  const instalacion = instalacionDe(user.organization.tipoInstalacion);

  return (
    <>
      <PageHeader
        title="Puesta en marcha"
        description={`Lo que falta para que ${instalacion.sustantivo} quede operando en el sistema. Cada paso lo lleva a la pantalla donde se resuelve.`}
      />
      <PanelPuestaEnMarcha
        pasos={marcha.pasos}
        porcentaje={marcha.porcentaje}
        completa={marcha.completa}
        saludDatos={marcha.saludDatos}
        faltanCatalogos={familias === 0}
        puedeSembrar={can(user.role, "settings:write")}
        iaDisponible={
          iaConfigurada() &&
          (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("REVISION")) &&
          can(user.role, "settings:write")
        }
      />
    </>
  );
}
