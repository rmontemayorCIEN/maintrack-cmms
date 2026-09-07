import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { trabajoDisponible } from "@/lib/armar-ot";
import { Card } from "@/components/ui";
import { Armador } from "./armador";

export const metadata = { title: "Armar orden de trabajo" };

/**
 * El armador de ordenes.
 *
 * Nace de un caso concreto: el tecnico va a bajar a la bomba por el preventivo
 * del mes, y de paso podria atender la fuga que reportaron y la actividad que
 * quedo trabada la vez pasada por falta de refaccion. Antes eso eran tres
 * ordenes y tres viajes, porque no habia forma de juntarlas.
 *
 * Se elige primero el equipo y luego se ve TODO lo que se le debe, de los tres
 * origenes, para decidir con la informacion enfrente.
 */
export default async function ArmarOrdenPage({
  searchParams,
}: {
  searchParams: Promise<{ activo?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "workorder:write")) redirect("/work-orders");

  const { activo } = await searchParams;

  const [activos, tecnicos] = await Promise.all([
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, criticality: true,
        location: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const disponible = activo ? await trabajoDisponible(user.organizationId, activo) : null;
  const elegido = activos.find((a) => a.id === activo) ?? null;

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/work-orders"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Órdenes de trabajo
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Armar una orden</h1>
        <p className="text-xs text-slate-500">
          Elija el equipo y vea todo lo que se le debe. Lo que marque se va en una sola orden,
          y cada actividad conserva de donde vino.
        </p>
      </div>

      <Card>
        <Armador
          activos={activos.map((a) => ({
            id: a.id,
            etiqueta: `${a.code} — ${a.name}`,
            detalle: [a.category?.name, a.location?.name].filter(Boolean).join(" · ") || null,
          }))}
          activoElegido={activo ?? ""}
          nombreActivo={elegido ? `${elegido.code} — ${elegido.name}` : null}
          tecnicos={tecnicos}
          disponible={disponible}
        />
      </Card>
    </div>
  );
}
