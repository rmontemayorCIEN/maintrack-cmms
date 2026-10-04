import Link from "next/link";
import { Loader2, Presentation } from "lucide-react";
import { VolverAPresentacion } from "./volver-presentacion";

/** Aviso fijo de la empresa demostrativa: nadie la confunde con una cuenta real. */
export function BandaDemo() {
  return (
    <div role="note" className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-900 no-print sm:px-4 lg:px-8">
      <span className="inline-flex items-center gap-1.5"><Presentation className="h-3.5 w-3.5" /><strong>Empresa demostrativa</strong> · todos los datos son de ejemplo</span>
      <span className="inline-flex items-center gap-3">
        <VolverAPresentacion />
        <Link href="/demo" className="font-medium underline underline-offset-2">Guía de la demostración</Link>
      </span>
    </div>
  );
}

export function DemoRestaurando() {
  return (
    <div role="status" className="mx-auto mt-10 max-w-md rounded-2xl border border-violet-200 bg-violet-50 p-6 text-center text-violet-900">
      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
      <p className="mt-3 font-semibold">La empresa demostrativa se está restaurando</p>
      <p className="mt-1 text-sm">Tarda menos de un minuto. Recargue la página en un momento.</p>
    </div>
  );
}
