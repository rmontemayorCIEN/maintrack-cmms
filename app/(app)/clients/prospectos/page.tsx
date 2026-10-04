import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";
import { ESTADOS_PROSPECTO } from "@/lib/prospectos";
import { INSTALACIONES, type ClaveInstalacion } from "@/lib/instalaciones";
import { planDe } from "@/lib/planes";
import { formatDateTime } from "@/lib/utils";
import { SeguimientoProspecto } from "./seguimiento";

export const metadata = { title: "Prospectos" };
export const dynamic = "force-dynamic";

/**
 * Solicitudes de demostración y de contratación. Lo mínimo para dar
 * seguimiento y aprender por qué se gana o se pierde; no es un CRM.
 */
export default async function ProspectosPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");
  const prospectos = await prisma.prospecto.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  const cuenta = (e: string) => prospectos.filter((p) => p.estado === e).length;
  const cerrados = cuenta("GANADA") + cuenta("PERDIDA");
  const origenes = Object.entries(prospectos.reduce<Record<string, number>>((m, p) => ({ ...m, [p.origen]: (m[p.origen] ?? 0) + 1 }), {}));
  const motivos = Object.entries(prospectos.filter((p) => p.motivoPerdida).reduce<Record<string, number>>((m, p) => ({ ...m, [p.motivoPerdida!]: (m[p.motivoPerdida!] ?? 0) + 1 }), {}));

  return (
    <>
      <PageHeader
        title="Prospectos"
        breadcrumb={<Link href="/clients" className="inline-flex items-center gap-1 hover:text-brand-600"><ArrowLeft className="h-3 w-3" /> Empresas cliente</Link>}
        description="Solicitudes de demostración y de contratación que llegan del sitio. Para convertir una en cliente, dela de alta en Empresas cliente."
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Nuevas" value={cuenta("NUEVA")} tone={cuenta("NUEVA") ? "warn" : "good"} hint="Sin contactar" />
        <Stat label="Demostraciones realizadas" value={prospectos.filter((p) => p.demoRealizadaAt).length} />
        <Stat label="Ganadas" value={cuenta("GANADA")} hint={cerrados ? `${Math.round((cuenta("GANADA") / cerrados) * 100)} % de las cerradas` : "Sin cerradas todavía"} />
        <Stat label="Perdidas" value={cuenta("PERDIDA")} hint={motivos.length ? motivos.map(([m, n]) => `${m}: ${n}`).join(" · ") : undefined} />
      </div>
      {origenes.length ? <p className="mb-4 text-xs text-slate-500">Por origen: {origenes.map(([o, n]) => `${o} ${n}`).join(" · ")}</p> : null}
      {prospectos.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay solicitudes.</p> : (
        <ul className="grid gap-3">
          {prospectos.map((p) => (
            <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-900">{p.empresa} <span className="font-normal text-slate-500">· {p.nombre}</span></p>
                <p className="text-xs text-slate-500">{p.tipo === "CONTRATACION" ? "Contratación" : "Demostración"} · {p.origen} · {formatDateTime(p.createdAt, user.organization.timezone)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {p.correo}{p.telefono ? ` · ${p.telefono}` : ""}{p.tipoInstalacion ? ` · ${INSTALACIONES[p.tipoInstalacion as ClaveInstalacion]?.nombre ?? p.tipoInstalacion}` : ""}
                {p.rangoActivos ? ` · ${p.rangoActivos} equipos` : ""}{p.planInteres ? ` · interés: ${planDe(p.planInteres).nombre}` : ""}{p.organizationId ? " · ya tiene cuenta" : ""}
              </p>
              {p.problema ? <p className="mt-2 text-slate-700">{p.problema}</p> : null}
              <SeguimientoProspecto p={{ id: p.id, estado: p.estado, resultado: p.resultado, motivoPerdida: p.motivoPerdida, notas: p.notas }} estados={ESTADOS_PROSPECTO.map((e) => ({ ...e }))} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
