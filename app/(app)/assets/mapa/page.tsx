import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { MapaActivos } from "./mapa-activos";

export const metadata = { title: "Mapa de activos" };
export const dynamic = "force-dynamic";

export default async function MapaDeActivosPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const conCoordenadas = { organizationId: orgId, active: true, latitud: { not: null }, longitud: { not: null } };

  const [sites, categories, conteo, rango, sinCoordenadas] = await Promise.all([
    prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.assetCategory.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.asset.count({ where: conCoordenadas }),
    prisma.asset.aggregate({ where: conCoordenadas, _min: { latitud: true, longitud: true }, _max: { latitud: true, longitud: true } }),
    prisma.asset.count({ where: { organizationId: orgId, active: true, OR: [{ latitud: null }, { longitud: null }] } }),
  ]);

  // La vista inicial abarca todo lo que tiene coordenadas. Sin nada ubicado,
  // el cliente decide el encuadre; aquí no se inventa uno.
  const encuadre = conteo > 0 && rango._min.latitud != null && rango._max.latitud != null &&
    rango._min.longitud != null && rango._max.longitud != null
    ? { sur: rango._min.latitud, norte: rango._max.latitud, oeste: rango._min.longitud, este: rango._max.longitud }
    : null;

  return (
    <>
      <PageHeader
        title="Mapa de activos"
        description="Dónde está cada equipo y en qué estado. Toque un punto para abrir su ficha."
        breadcrumb={
          <Link href="/assets" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="h-3 w-3" /> Catálogo de activos
          </Link>
        }
      />
      <Card>
        <MapaActivos
          sites={sites}
          categories={categories}
          conCoordenadas={conteo}
          sinCoordenadas={sinCoordenadas}
          encuadre={encuadre}
        />
      </Card>
    </>
  );
}
