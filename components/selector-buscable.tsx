"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type OpcionBuscable = {
  id: string;
  /** Lo que se ve y por lo que se busca. Normalmente «CLAVE — Nombre». */
  etiqueta: string;
  /** Segunda linea: criticidad, ubicacion, existencia. Tambien se busca aqui. */
  detalle?: string | null;
  /** Palabras extra por las que deberia encontrarse sin que se muestren. */
  alias?: string | null;
};

/**
 * Un desplegable que se puede buscar.
 *
 * Un `<select>` con doscientos equipos obliga a recorrer la lista con el raton
 * hasta dar con la bomba. Aqui se escribe «bomba» o la clave y la lista se
 * reduce sola.
 *
 * La busqueda ignora acentos en los dos sentidos: escribir "hidroneumatico"
 * encuentra "hidroneumático" y al reves. En un catalogo en espanol capturado
 * por varias personas, exigir el acento es exigir que se adivine como lo
 * escribio quien dio de alta el equipo.
 */
const sinAcentos = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function SelectorBuscable({
  valor,
  onCambio,
  opciones,
  vacio = "Sin seleccionar",
  marcador = "Busque por clave o nombre",
  deshabilitado,
  requerido,
  className,
  name,
}: {
  valor: string;
  onCambio: (id: string) => void;
  opciones: OpcionBuscable[];
  /** Texto de la opcion sin valor. Null lo quita: el campo se vuelve obligatorio. */
  vacio?: string | null;
  marcador?: string;
  deshabilitado?: boolean;
  requerido?: boolean;
  className?: string;
  /** Para usarlo dentro de un formulario normal: emite un campo oculto con el valor. */
  name?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [resaltado, setResaltado] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const idLista = useId();

  const elegida = opciones.find((o) => o.id === valor) ?? null;

  const filtradas = useMemo(() => {
    const q = sinAcentos(consulta.trim());
    if (!q) return opciones;
    const palabras = q.split(/\s+/);
    return opciones.filter((o) => {
      const texto = sinAcentos(`${o.etiqueta} ${o.detalle ?? ""} ${o.alias ?? ""}`);
      // Todas las palabras, en cualquier orden: "bomba 001" encuentra
      // "BOM-001 — Bomba hidroneumática".
      return palabras.every((p) => texto.includes(p));
    });
  }, [opciones, consulta]);

  useEffect(() => setResaltado(0), [consulta]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  useEffect(() => {
    if (abierto) entrada.current?.focus();
    else setConsulta("");
  }, [abierto]);

  // Mantener a la vista lo resaltado cuando se navega con el teclado.
  useEffect(() => {
    if (!abierto) return;
    lista.current?.children[resaltado]?.scrollIntoView({ block: "nearest" });
  }, [resaltado, abierto]);

  function elegir(id: string) {
    onCambio(id);
    setAbierto(false);
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((r) => Math.min(r + 1, filtradas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((r) => Math.max(r - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtradas[resaltado];
      if (o) elegir(o.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAbierto(false);
    }
  }

  return (
    <div ref={contenedor} className={cn("relative", className)}>
      {name ? <input type="hidden" name={name} value={valor} /> : null}
      <button
        type="button"
        disabled={deshabilitado}
        onClick={() => setAbierto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className={cn(
          "field flex w-full items-center gap-2 text-left",
          deshabilitado && "cursor-not-allowed opacity-60",
          requerido && !valor && "border-amber-300",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", elegida ? "text-slate-800" : "text-slate-400")}>
          {elegida ? elegida.etiqueta : (vacio ?? marcador)}
        </span>
        {elegida && vacio !== null && !deshabilitado ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Quitar selección"
            onClick={(e) => { e.stopPropagation(); onCambio(""); }}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", abierto && "rotate-180")} />
      </button>

      {abierto ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={entrada}
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              onKeyDown={teclas}
              placeholder={marcador}
              aria-controls={idLista}
              aria-autocomplete="list"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
            <span className="shrink-0 text-[0.6875rem] tabular-nums text-slate-400">
              {filtradas.length}
            </span>
          </div>

          <ul ref={lista} id={idLista} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {vacio !== null && !consulta ? (
              <li
                role="option"
                aria-selected={!valor}
                onClick={() => elegir("")}
                className="cursor-pointer px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
              >
                {vacio}
              </li>
            ) : null}

            {filtradas.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                Nada coincide con «{consulta}»
              </li>
            ) : (
              filtradas.map((o, i) => (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={o.id === valor}
                  onMouseEnter={() => setResaltado(i)}
                  onClick={() => elegir(o.id)}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 px-3 py-1.5",
                    i === resaltado && "bg-slate-50",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">{o.etiqueta}</span>
                    {o.detalle ? (
                      <span className="block truncate text-xs text-slate-400">{o.detalle}</span>
                    ) : null}
                  </span>
                  {o.id === valor ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
