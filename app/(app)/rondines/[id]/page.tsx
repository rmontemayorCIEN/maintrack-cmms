import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { NOMBRE_IDENTIFICACION, type ComoSeIdentifico } from "@/lib/rondin";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Recorrido" };

/**
 * Un recorrido, parada por parada.
 *
 * De cada parada se dice COMO se supo de que equipo era. No es un detalle
 * tecnico: una parada identificada por su codigo QR vale distinto que una que
 * alguien dedujo de lo que oyo, y quien lea esto un mes despues tiene derecho
 * a saber de cual se trata antes de tomar una decision.
 */
export default async function RondinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const rondin = await prisma.rondin.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      id: true, numero: true, estado: true, iniciadoEn: true, terminadoEn: true, nota: true,
      location: { select: { name: true } },
      iniciadoPor: { select: { name: true } },
      paradas: {
        orderBy: { orden: "asc" },
        select: {
          id: true, orden: true, comoSeIdentifico: true, observacion: true, createdAt: true,
          asset: { select: { id: true, code: true, name: true } },
          location: { select: { name: true } },
          reportPoint: { select: { nombre: true } },
        },
      },
    },
  });
  if (!rondin) notFound();

  return (
    <div className="space-y-5">
      <Link href="/rondines" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Rondines
      </Link>

      <PageHeader
        title={rondin.numero}
        description={`${rondin.location?.name ?? "Toda la planta"} · ${rondin.iniciadoPor?.name ?? "—"} · ${formatDateTime(rondin.iniciadoEn)}`}
      />

      {rondin.nota ? (
        <Card><p className="text-xs text-slate-700">{rondin.nota}</p></Card>
      ) : null}

      {rondin.paradas.length === 0 ? (
        <Card><p className="text-xs text-slate-600">Este recorrido no tiene paradas.</p></Card>
      ) : (
        <div className="grid gap-2">
          {rondin.paradas.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-500">Parada {p.orden}</p>
                  <p className="mt-1 text-sm text-slate-800">{p.observacion ?? "(sin nota)"}</p>
                </div>
                <Badge tone={p.asset ? "info" : "muted"}>
                  {p.asset ? `${p.asset.code}` : "Sin equipo"}
                </Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-slate-500">
                {p.asset ? <span>{p.asset.name}</span> : null}
                {p.reportPoint ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{p.reportPoint.nombre}</span> : null}
                {p.location ? <span>{p.location.name}</span> : null}
                {/* De dónde salió el dato, para que nadie lo dé por más firme
                    de lo que es. */}
                <span className="text-slate-400">
                  {NOMBRE_IDENTIFICACION[p.comoSeIdentifico as ComoSeIdentifico] ?? p.comoSeIdentifico}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
