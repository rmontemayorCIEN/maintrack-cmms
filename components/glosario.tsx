"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import {
  buscarTermino,
  crearRegexGlosario,
  type TerminoGlosario,
} from "@/lib/glosario";

/* La expresion se construye una sola vez por carga: recorrerla es barato,
   rearmarla en cada render no lo seria. */
const REGEX = crearRegexGlosario();

/**
 * Envuelve un texto y subraya los terminos del glosario que encuentre.
 * Al hacer clic se abre la definicion sin sacar al usuario de donde esta.
 *
 *   <Glosa>El MTTR subio 2 h este mes</Glosa>
 *
 * Solo procesa cadenas. Si recibe otra cosa la devuelve intacta, para poder
 * usarlo sin miedo dentro de componentes que a veces reciben JSX.
 */
export function Glosa({ children }: { children: ReactNode }) {
  if (typeof children !== "string") return <>{children}</>;
  return <>{marcar(children)}</>;
}

function marcar(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;

  REGEX.lastIndex = 0;
  while ((m = REGEX.exec(texto)) !== null) {
    const termino = buscarTermino(m[0]);
    if (!termino) continue;

    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(
      <TerminoMarcado key={`${m.index}-${m[0]}`} termino={termino} texto={m[0]} />,
    );
    ultimo = m.index + m[0].length;
  }

  if (!partes.length) return [texto];
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

function TerminoMarcado({ termino, texto }: { termino: TerminoGlosario; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  return (
    <span ref={contenedor} className="relative inline">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAbierto((v) => !v); }}
        title="Ver definición"
        aria-expanded={abierto}
        className="cursor-help border-b border-dotted border-slate-400 font-inherit text-inherit transition-colors hover:border-brand-500 hover:text-brand-700"
      >
        {texto}
      </button>

      {abierto ? (
        <span
          role="dialog"
          className="absolute left-0 top-full z-50 mt-1.5 block w-72 rounded-xl border border-slate-200 bg-white p-3.5 text-left normal-case tracking-normal shadow-lg sm:w-80"
        >
          <span className="mb-1 flex items-start justify-between gap-2">
            <span className="block">
              <span className="block text-sm font-semibold text-slate-900">{termino.t}</span>
              {termino.n ? (
                <span className="block text-[0.6875rem] text-slate-500">{termino.n}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>

          <span className="mt-1.5 block text-xs leading-relaxed text-slate-600">{termino.d}</span>

          <Link
            href={`/glossary?q=${encodeURIComponent(termino.t)}`}
            onClick={() => setAbierto(false)}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-brand-600 hover:underline"
          >
            <BookOpen className="h-3 w-3" /> Abrir el glosario
          </Link>
        </span>
      ) : null}
    </span>
  );
}
