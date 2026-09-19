import Link from "next/link";
import { MarcoPublico } from "@/components/publico/marco";
import { DOCUMENTOS, ESTADO_DOCUMENTOS, VERSION_DOCUMENTOS } from "@/lib/legal";

export const metadata = { title: "Documentos" };

export default function LegalPage() {
  return (
    <MarcoPublico>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Documentos</h1>
        <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{ESTADO_DOCUMENTOS} Versión {VERSION_DOCUMENTOS}.</p>
        <ul className="mt-6 grid gap-3">
          {DOCUMENTOS.map((d) => (
            <li key={d.clave} className="rounded-xl border border-slate-200 p-4">
              <Link href={`/legal/${d.clave}`} className="font-medium text-brand-700 hover:underline">{d.titulo}</Link>
              <p className="mt-1 text-sm text-slate-600">{d.resumen}</p>
            </li>
          ))}
        </ul>
      </main>
    </MarcoPublico>
  );
}
