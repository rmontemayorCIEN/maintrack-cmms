import Link from "next/link";
import { Wrench } from "lucide-react";
import { MARCA } from "@/lib/comercial";
import { DOCUMENTOS } from "@/lib/legal";

/**
 * El marco de las páginas públicas: sitio, contratación y documentos.
 * Encabezado con la marca y las dos salidas (entrar, pedir demostración) y un
 * pie con todos los documentos, para que ninguno quede sin liga.
 */
export function MarcoPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><Wrench className="h-4 w-4" /></span>
            {MARCA}
          </Link>
          <nav aria-label="Sitio" className="hidden items-center gap-5 text-sm text-slate-600 md:flex">
            <Link href="/#como-funciona" className="hover:text-slate-900">Cómo funciona</Link>
            <Link href="/#planes" className="hover:text-slate-900">Planes</Link>
            <Link href="/#preguntas" className="hover:text-slate-900">Preguntas</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">Iniciar sesión</Link>
            <Link href="/#demostracion" className="hidden min-h-10 items-center rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 sm:inline-flex">Solicitar demostración</Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm md:grid-cols-[1fr_2fr]">
          <div>
            <p className="font-semibold text-slate-900">{MARCA}</p>
            <p className="mt-2 text-slate-600">Gestión y confiabilidad del mantenimiento.</p>
            <p className="mt-4 text-xs text-slate-500">Clientes: el soporte se pide dentro de MainTrack, en Soporte.</p>
          </div>
          <nav aria-label="Documentos" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DOCUMENTOS.map((d) => (
              <Link key={d.clave} href={`/legal/${d.clave}`} className="text-slate-600 hover:text-slate-900">{d.titulo}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
