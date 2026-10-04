import Link from "next/link";
import { notFound } from "next/navigation";
import { MarcoPublico } from "@/components/publico/marco";
import { DOCUMENTOS, ESTADO_DOCUMENTOS, VERSION_DOCUMENTOS, documento } from "@/lib/legal";

export function generateStaticParams() {
  return DOCUMENTOS.map((d) => ({ documento: d.clave }));
}

export async function generateMetadata({ params }: { params: Promise<{ documento: string }> }) {
  const d = documento((await params).documento);
  return { title: d?.titulo ?? "Documento" };
}

export default async function DocumentoPage({ params }: { params: Promise<{ documento: string }> }) {
  const d = documento((await params).documento);
  if (!d) notFound();
  return (
    <MarcoPublico>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/legal" className="text-sm text-slate-500 hover:text-slate-800">← Documentos</Link>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900 [text-wrap:balance]">{d.titulo}</h1>
        <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {ESTADO_DOCUMENTOS} Versión {VERSION_DOCUMENTOS}.
        </p>
        <div className="mt-6 grid gap-6 text-[0.9375rem] leading-relaxed text-slate-700">
          {d.secciones.map((s) => (
            <section key={s.titulo}>
              <h2 className="text-base font-semibold text-slate-900">{s.titulo}</h2>
              {s.parrafos.map((p, i) => <p key={i} className="mt-2 max-w-prose">{p}</p>)}
            </section>
          ))}
        </div>
      </main>
    </MarcoPublico>
  );
}
