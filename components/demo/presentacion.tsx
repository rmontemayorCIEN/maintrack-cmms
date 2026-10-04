"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, List, X } from "lucide-react";
import { MARCA } from "@/lib/comercial";
import { olvidarPresentacion, recordarPresentacion } from "./volver-presentacion";
import type { Bloque, Diapositiva } from "@/lib/demo-presentacion";

/**
 * La presentación al cliente: una diapositiva a la vez, a pantalla completa.
 *
 * Por qué a pantalla completa y no una pantalla normal: en una junta se
 * proyecta, y el menú, la banda de la demo y el inicio de sesión distraen y
 * delatan. Se sale con Escape.
 *
 * El número de diapositiva vive en la dirección (?d=3) y se escribe con
 * `replaceState`: así, cuando se abre una pantalla real del sistema desde un
 * botón, el «Atrás» del navegador regresa a la MISMA diapositiva —que es lo
 * que se pidió—, y avanzar veinte veces no deja veinte entradas en el
 * historial que haya que recorrer para volver.
 */
export function Presentacion({ diapositivas, inicial }: { diapositivas: Diapositiva[]; inicial: number }) {
  const total = diapositivas.length;
  const [i, setI] = useState(() => Math.min(Math.max(inicial, 0), total - 1));
  const [indice, setIndice] = useState(false);

  const ir = useCallback((n: number) => {
    const d = Math.min(Math.max(n, 0), total - 1);
    setI(d);
    setIndice(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("d", String(d + 1));
      window.history.replaceState(null, "", url);
    } catch { /* sin historial: la presentación sigue, solo no se puede regresar a la misma diapositiva */ }
  }, [total]);

  // Dónde se quedó, para que la banda de la demo ofrezca el regreso desde
  // cualquier pantalla del sistema. Se anota al abrir y en cada cambio, no
  // solo al salir a una pantalla: así también sirve si se sale por el menú.
  useEffect(() => { recordarPresentacion(i + 1, diapositivas[i].titulo); }, [i, diapositivas]);

  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      const en = e.target as HTMLElement | null;
      if (en && (en.tagName === "INPUT" || en.tagName === "TEXTAREA" || en.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); ir(i + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); ir(i - 1); }
      else if (e.key === "Home") { e.preventDefault(); ir(0); }
      else if (e.key === "End") { e.preventDefault(); ir(total - 1); }
      else if (e.key === "Escape") { if (indice) setIndice(false); else { olvidarPresentacion(); window.location.assign("/demo"); } }
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [i, total, ir, indice]);

  const d = diapositivas[i];
  const secciones = useMemo(() => {
    const grupos: Array<{ seccion: string; items: Array<{ n: number; titulo: string }> }> = [];
    diapositivas.forEach((x, n) => {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.seccion === x.seccion) ultimo.items.push({ n, titulo: x.titulo });
      else grupos.push({ seccion: x.seccion, items: [{ n, titulo: x.titulo }] });
    });
    return grupos;
  }, [diapositivas]);

  const centrada = Boolean(d.presentacion);

  return (
    <div data-presentacion="" className="fixed inset-0 z-50 flex flex-col bg-white text-slate-900 no-print">
      <div aria-hidden className="h-1 w-full bg-slate-100"><div className="h-full bg-violet-600 transition-all" style={{ width: `${((i + 1) / total) * 100}%` }} /></div>

      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 sm:px-6">
        <button type="button" onClick={() => setIndice((v) => !v)} aria-expanded={indice} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
          <List className="h-4 w-4" /> <span className="hidden sm:inline">{d.seccion}</span> <span className="tabular-nums text-slate-500">{i + 1}/{total}</span>
        </button>
        {d.rol ? <span className="hidden truncate rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-900 md:inline">Se muestra como: {d.rol}</span> : null}
        <Link href="/demo" onClick={olvidarPresentacion} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          <X className="h-4 w-4" /> Salir
        </Link>
      </header>

      {indice ? (
        <nav aria-label="Índice de la presentación" className="absolute inset-x-0 top-[3.3rem] z-10 max-h-[70vh] overflow-y-auto border-b border-slate-200 bg-white p-4 shadow-lg sm:p-6">
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {secciones.map((g) => (
              <div key={g.seccion + g.items[0].n}>
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{g.seccion}</p>
                <ul className="mt-1 grid gap-0.5">
                  {g.items.map((x) => (
                    <li key={x.n}>
                      <button type="button" onClick={() => ir(x.n)} className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${x.n === i ? "bg-slate-100 font-semibold" : "text-slate-700"}`}>
                        <span className="tabular-nums text-slate-400">{x.n + 1}.</span> {x.titulo}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      ) : null}

      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
        <div className={`mx-auto max-w-5xl ${centrada ? "flex min-h-full flex-col justify-center text-center" : ""}`}>
          {d.presentacion === "portada" ? <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-700">{MARCA}</p> : null}
          {d.minutos ? <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{d.seccion} · {d.minutos} min</p> : null}
          <h1 className={`text-balance font-semibold tracking-tight ${centrada ? "text-3xl sm:text-5xl" : "text-2xl sm:text-4xl"}`}>{d.titulo}</h1>
          {d.entradilla ? <p className={`mt-3 text-pretty text-slate-600 ${centrada ? "mx-auto max-w-3xl text-lg sm:text-2xl" : "max-w-4xl text-base sm:text-xl"}`}>{d.entradilla}</p> : null}
          <div className={`mt-6 grid gap-4 ${centrada ? "text-left" : ""}`}>{d.bloques.map((b, n) => <DibujarBloque key={n} b={b} />)}</div>

          {d.ligas?.length ? (
            <div className={`mt-6 flex flex-wrap gap-2 ${centrada ? "justify-center" : ""}`}>
              <span className="sr-only">Abrir en el sistema:</span>
              {d.ligas.map((l) => (
                <Link key={l.href + l.etiqueta} href={l.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-sm font-semibold text-violet-900 hover:bg-violet-100">
                  {l.etiqueta} <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          ) : null}

          {d.nota ? (
            <details className="mt-6 text-left">
              <summary className="cursor-pointer text-sm font-medium text-slate-500 hover:text-slate-800">Nota para quien presenta</summary>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">{d.nota}</p>
            </details>
          ) : null}
        </div>
      </main>

      <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 sm:px-6">
        <button type="button" onClick={() => ir(i - 1)} disabled={i === 0} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" /> Anterior
        </button>
        <p className="truncate text-xs text-slate-500">{i + 1 < total ? `Sigue: ${diapositivas[i + 1].titulo}` : "Última diapositiva"}</p>
        <button type="button" onClick={() => ir(i + 1)} disabled={i + 1 === total} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
          Siguiente <ArrowRight className="h-4 w-4" />
        </button>
      </footer>
    </div>
  );
}

function DibujarBloque({ b }: { b: Bloque }) {
  switch (b.tipo) {
    case "parrafo":
      return <p className="max-w-4xl text-pretty text-base text-slate-700 sm:text-lg">{b.texto}</p>;
    case "puntos":
      return (
        <ul className="grid max-w-4xl gap-2">
          {b.items.map((x) => <li key={x} className="flex gap-2 text-base text-slate-700 sm:text-lg"><span aria-hidden className="text-violet-600">•</span>{x}</li>)}
        </ul>
      );
    case "tarjetas":
      return (
        <ul className={`grid gap-3 sm:grid-cols-2 ${b.columnas === 3 ? "lg:grid-cols-3" : ""}`}>
          {b.items.map((x) => (
            <li key={x.titulo} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">{x.titulo}</p>
              <p className="mt-1 text-sm text-slate-600">{x.texto}</p>
              {x.pie ? <p className="mt-1 text-xs text-slate-500">{x.pie}</p> : null}
            </li>
          ))}
        </ul>
      );
    case "pasos":
      return (
        <ol className="grid gap-2">
          {b.items.map((x, n) => (
            <li key={x.titulo + n} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-semibold tabular-nums text-violet-800">{n + 1}</span>
              <span>{x.titulo ? <span className="font-semibold text-slate-900">{x.titulo}: </span> : null}<span className="text-slate-700">{x.texto}</span></span>
            </li>
          ))}
        </ol>
      );
    case "cambio":
      return (
        <ul className="grid gap-2">
          {b.items.map((x) => (
            <li key={x.antes} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1.2fr_1fr] sm:items-center">
              <div>
                <p className="font-semibold text-slate-900">{x.antes}</p>
                <p className="mt-0.5 text-sm text-slate-600">{x.detalle}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2">
                <p className="text-sm font-semibold text-emerald-900">{x.despues}</p>
                <p className="mt-0.5 text-xs text-emerald-800">{x.capacidades.join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
      );
    case "destacado":
      return (
        <p className="max-w-4xl rounded-xl bg-slate-100 px-4 py-3 text-base text-slate-800 sm:text-lg">
          <strong className="font-semibold text-slate-900">{b.titulo}: </strong>{b.texto}
        </p>
      );
    case "planes":
      return (
        <ul className="grid gap-3 sm:grid-cols-2">
          {b.items.map((x) => (
            <li key={x.nombre} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-lg font-semibold text-slate-900">{x.nombre}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-violet-700">{x.precio}</p>
              <p className="mt-1 text-sm text-slate-600">{x.descripcion}</p>
              {x.nota ? <p className="mt-1 text-xs text-slate-500">{x.nota}</p> : null}
              <ul className="mt-3 grid gap-1 text-sm text-slate-700">
                {x.incluye.map((y) => <li key={y} className="flex gap-2"><span aria-hidden className="text-emerald-600">✓</span>{y}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      );
    case "filas":
      return (
        <dl className="grid gap-2">
          {b.items.map((x) => (
            <div key={x.etiqueta} className="grid gap-0.5 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
              <dt className="font-semibold text-slate-900">{x.etiqueta}</dt>
              <dd className="text-slate-700">{x.texto}</dd>
            </div>
          ))}
        </dl>
      );
  }
}
