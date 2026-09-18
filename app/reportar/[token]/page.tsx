import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { contextoDelPunto, vistaPublicaDelPunto } from "@/lib/portal";
import { AvisoDeDatos } from "@/components/aviso-de-datos";
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

  // Hacia afuera sale lo minimo; por dentro la solicitud conserva equipo, area
  // y planta. Lo que se enseña lo decide la configuracion del punto.
  const vista = vistaPublicaDelPunto(punto);
  const referencia = [vista.punto, vista.lugar].filter(Boolean).join(" — ");

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        {vista.empresa ? (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{vista.empresa}</p>
        ) : null}
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Reportar una falla</h1>
        {referencia ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{referencia}</span>
          </p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Ya sabemos de dónde viene el reporte. Solo díganos qué pasa.
        </p>
      </header>

      <FormularioReporte token={token} empresa={vista.empresa} lugar={vista.lugar} />
      <AvisoDeDatos url={vista.avisoPrivacidadUrl} />
    </main>
  );
}
