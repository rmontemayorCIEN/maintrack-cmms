import { redirect } from "next/navigation";
import Link from "next/link";
import { Receipt, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { PanelClientes } from "./panel";
import { consumoPorOrganizacion } from "@/lib/ia/consumo";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { formatoUsd } from "@/lib/ia/precios";
import { avancePuestaEnMarcha } from "@/lib/puesta-en-marcha";

export const metadata = { title: "Empresas cliente" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");

  const solicitudes = await prisma.planRequest.findMany({
    where: { status: "PENDING" },
    include: {
      organization: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const organizaciones = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, slug: true, plan: true, status: true,
      industry: true, tipoInstalacion: true, trialEndsAt: true, createdAt: true,
      iaComplemento: true, iaExtra: true,
      _count: { select: { users: true, assets: true, workOrders: true } },
    },
  });

  const consumoIa = await consumoPorOrganizacion();
  // Avance de puesta en marcha por cliente: una cuenta estancada en 20% a las
  // tres semanas es una cuenta que no va a renovar, y conviene saberlo antes.
  // En serie a proposito: cada avance son varias decenas de conteos y la
  // instancia de Cloud SQL admite pocas conexiones simultaneas. Con veinte
  // clientes, en paralelo, esta pantalla se caeria.
  const avances = new Map<string, Awaited<ReturnType<typeof avancePuestaEnMarcha>>>();
  for (const o of organizaciones) {
    avances.set(o.id, await avancePuestaEnMarcha(o.id));
  }
  const costoIaDelMes = [...consumoIa.values()].reduce((s, c) => s + c.costoUsd, 0);

  const activas = organizaciones.filter((o) => ["ACTIVE", "TRIAL"].includes(o.status));
  const totalActivos = organizaciones.reduce((s, o) => s + o._count.assets, 0);
  const totalUsuarios = organizaciones.reduce((s, o) => s + o._count.users, 0);

  return (
    <>
      <PageHeader
        title="Empresas cliente"
        description="Alta y administración de las empresas que usan la plataforma. Cada una tiene sus activos, usuarios y datos completamente aislados de las demás."
        actions={
          <>
          <Link
            href="/clients/ia"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> Consumo de IA
            {costoIaDelMes > 0 ? <span className="text-slate-400">{formatoUsd(costoIaDelMes)}</span> : null}
          </Link>
          <Link
            href="/clients/cobranza"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Receipt className="h-3.5 w-3.5" /> Cobranza
          </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Empresas" value={organizaciones.length} hint={`${activas.length} activas o en prueba`} />
        <Stat label="Usuarios en total" value={totalUsuarios} />
        <Stat label="Activos administrados" value={formatNumber(totalActivos, 0)} />
        <Stat
          label="Suspendidas"
          value={organizaciones.filter((o) => o.status === "SUSPENDED").length}
          tone={organizaciones.some((o) => o.status === "SUSPENDED") ? "warn" : "good"}
        />
      </div>

      <PanelClientes
        solicitudes={solicitudes.map((s) => ({
          id: s.id,
          empresa: s.organization.name,
          planActual: s.planActual,
          planSolicitado: s.planSolicitado,
          nota: s.nota,
          pedidoPor: s.requestedBy?.name ?? null,
          createdAt: s.createdAt.toISOString(),
        }))}
        organizaciones={organizaciones.map((o) => {
          const consumo = consumoIa.get(o.id);
          return {
            ...o,
            trialEndsAt: o.trialEndsAt?.toISOString() ?? null,
            createdAt: o.createdAt.toISOString(),
            avance: avances.get(o.id) ?? { porcentaje: 0, completa: false, siguiente: null },
            ia: {
              operaciones: consumo?.operaciones ?? 0,
              incluidas: iaDeLaOrganizacion(o).operaciones,
              costoUsd: consumo?.costoUsd ?? 0,
            },
          };
        })}
        organizacionPropiaId={user.organizacionPropia.id}
      />
    </>
  );
}
