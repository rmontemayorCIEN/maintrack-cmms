import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { contextoDelPunto } from "@/lib/portal";
import { FormularioReporte } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportar una falla" };

/**
 * Portal publico de reporte. Fuera del grupo (app), asi que no pide sesion.
 *
 * Todo el contexto —empresa, sitio, ubicacion, equipo— sale del token del
 * codigo. Quien reporta no elige nada de eso ni tiene por que saberlo.
 */
export default async function ReportarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const punto = await contextoDelPunto(token);
  if (!punto) notFound();

  const lugar = [punto.asset ? `${punto.asset.code} · ${punto.asset.name}` : null, punto.location?.name, punto.site?.name]
    .filter(Boolean).join(" — ");

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{punto.organization.name}</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Reportar una falla</h1>
        {lugar ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{lugar}</span>
          </p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Ya sabemos de dónde viene el reporte. Solo díganos qué pasa.
        </p>
      </header>

      <FormularioReporte token={token} empresa={punto.organization.name} lugar={punto.location?.name ?? punto.site?.name ?? null} />
    </main>
  );
}
