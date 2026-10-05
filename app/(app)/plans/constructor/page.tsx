import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { constructorDePlanes } from "@/lib/constructor-planes";
import { historiaDeConstruccion } from "@/lib/constructor-historia";
import { PageHeader } from "@/components/ui";
import { PanelConstructor } from "./panel";

export const metadata = { title: "Constructor de planes" };
export const dynamic = "force-dynamic";

/**
 * Donde esta la empresa en la construccion de su programa preventivo.
 *
 * La pantalla no crea nada: mide. Cuantos planes se necesitan (grupos de
 * equipos iguales), cuantos hay, cuales estan terminados y que le falta a cada
 * uno. Lo que si guarda es la meta, que es una decision de la persona.
 */
export default async function ConstructorPage() {
  const user = await requireUser();
  const [c, historia] = await Promise.all([
    constructorDePlanes(user.organizationId),
    historiaDeConstruccion(user.organizationId),
  ]);

  return (
    <>
      <PageHeader
        title="Constructor de planes"
        description="Cuántos planes le faltan, qué le falta a cada uno y a qué ritmo va."
        breadcrumb={
          <Link href="/plans" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-3.5 w-3.5" />
            Planes preventivos
          </Link>
        }
      />
      <PanelConstructor
        datos={{
          ...c,
          metaFijadaEl: c.metaFijadaEl?.toISOString() ?? null,
          fechaTermino: c.fechaTermino?.toISOString() ?? null,
          planes: c.planes.map((p) => ({ ...p, creadoEl: p.creadoEl.toISOString() })),
          historia,
        }}
        editable={can(user.role, "plan:write")}
      />
    </>
  );
}
