import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";
import { SEVERIDADES } from "@/lib/comercial";
import { ESTADOS_SOPORTE, respuestaObjetivo, type EstadoSoporte } from "@/lib/soporte";
import { formatDateTime } from "@/lib/utils";
import { ResponderSoporte } from "./responder";

export const metadata = { title: "Soporte a clientes" };
export const dynamic = "force-dynamic";

/** Las solicitudes de soporte de todas las empresas, abiertas primero y por severidad. */
export default async function SoporteOperadorPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");
  const orden = SEVERIDADES.map((s) => s.clave as string);
  const todas = await prisma.solicitudSoporte.findMany({
    orderBy: { createdAt: "desc" }, take: 300,
    include: { organization: { select: { name: true, plan: true, esDemo: true } }, user: { select: { name: true, email: true } } },
  });
  const abiertas = todas.filter((s) => !["RESUELTA", "CERRADA"].includes(s.estado)).sort((a, b) => orden.indexOf(a.severidad) - orden.indexOf(b.severidad));
  const resto = todas.filter((s) => ["RESUELTA", "CERRADA"].includes(s.estado));
  const sinRespuesta = abiertas.filter((s) => !s.primeraRespuestaAt).length;

  const tarjeta = (s: (typeof todas)[number]) => (
    <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-slate-900"><span className="font-mono text-xs text-slate-500">{s.folio}</span> · {s.asunto}</p>
        <p className="text-xs text-slate-500">{s.organization.name}{s.organization.esDemo ? " (demo)" : ""} · {s.user?.name ?? "—"} · {formatDateTime(s.createdAt, user.organization.timezone)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-600">{SEVERIDADES.find((x) => x.clave === s.severidad)?.nombre} · objetivo de respuesta {respuestaObjetivo(s.severidad, s.organization.plan)} · {ESTADOS_SOPORTE[s.estado as EstadoSoporte]}{s.pantalla ? ` · pantalla: ${s.pantalla}` : ""}</p>
      <p className="mt-2 whitespace-pre-wrap text-slate-700">{s.descripcion}</p>
      {s.datosTecnicos ? <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Datos técnicos</summary><pre className="mt-1 whitespace-pre-wrap">{s.datosTecnicos}</pre></details> : null}
      <ResponderSoporte id={s.id} estado={s.estado} respuesta={s.respuesta ?? ""} estados={Object.entries(ESTADOS_SOPORTE).map(([clave, nombre]) => ({ clave, nombre }))} />
    </li>
  );

  return (
    <>
      <PageHeader title="Soporte a clientes" breadcrumb={<Link href="/clients" className="inline-flex items-center gap-1 hover:text-brand-600"><ArrowLeft className="h-3 w-3" /> Empresas cliente</Link>}
        description="Lo que piden los clientes desde MainTrack › Soporte. Cada cambio de estado o respuesta le llega a quien lo pidió en su campana." />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Abiertas" value={abiertas.length} tone={abiertas.length ? "warn" : "good"} />
        <Stat label="Sin primera respuesta" value={sinRespuesta} tone={sinRespuesta ? "bad" : "good"} />
        <Stat label="Resueltas o cerradas" value={resto.length} />
      </div>
      {abiertas.length ? <ul className="grid gap-3">{abiertas.map(tarjeta)}</ul> : <p className="text-sm text-slate-500">No hay solicitudes abiertas.</p>}
      {resto.length ? <details className="mt-6"><summary className="cursor-pointer text-sm font-medium text-slate-700">Resueltas y cerradas ({resto.length})</summary><ul className="mt-3 grid gap-3">{resto.map(tarjeta)}</ul></details> : null}
    </>
  );
}
