import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { puestaEnMarcha } from "@/lib/puesta-en-marcha";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { INSTALACIONES, instalacionDe } from "@/lib/instalaciones";
import { formatDate } from "@/lib/utils";
import { ZONA_POR_OMISION } from "@/lib/periodos";
import { PanelPuestaEnMarcha } from "./panel";

export const metadata = { title: "Puesta en marcha" };
export const dynamic = "force-dynamic";

export default async function PuestaEnMarchaPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const [marcha, sitios, activos] = await Promise.all([
    puestaEnMarcha(orgId, { conSalud: true }),
    prisma.site.count({ where: { organizationId: orgId } }),
    prisma.asset.count({ where: { organizationId: orgId } }),
  ]);

  const instalacion = instalacionDe(user.organization.tipoInstalacion);
  const zona = user.organization.timezone || ZONA_POR_OMISION;

  return (
    <>
      <PageHeader
        title="Puesta en marcha"
        description={`Lo que falta para que ${instalacion.sustantivo} quede operando en el sistema. Cada paso lo lleva a la pantalla donde se resuelve, y lo que capture se guarda ahí mismo.`}
      />
      <PanelPuestaEnMarcha
        pasos={marcha.pasos}
        porcentaje={marcha.porcentaje}
        completa={marcha.completa}
        pendientes={marcha.pendientes}
        saludDatos={marcha.saludDatos}
        operandoDesde={marcha.operandoDesde ? formatDate(marcha.operandoDesde, zona) : null}
        hayDemo={marcha.hayDemo}
        impideOperar={marcha.impideOperar}
        // Se ofrece cómo empezar mientras no haya estructura ni equipos.
        empezando={sitios === 0 && activos === 0 && !marcha.hayDemo}
        tipoInstalacion={user.organization.tipoInstalacion}
        tipos={Object.entries(INSTALACIONES).map(([clave, d]) => ({ clave, nombre: d.nombre }))}
        puedeConfigurar={can(user.role, "settings:write")}
        iaDisponible={
          iaConfigurada() &&
          (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("REVISION")) &&
          can(user.role, "settings:write")
        }
      />
    </>
  );
}
