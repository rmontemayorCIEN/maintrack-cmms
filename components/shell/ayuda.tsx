"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { CONTROLES_TABLA, ayudaDe } from "@/lib/ayuda";
import { AyudaConIa } from "./ayuda-ia";

/**
 * Ayuda de la pantalla en la que esta parado el usuario.
 *
 * Vive en la barra superior y sabe la ruta actual, asi que no hay que
 * mantenerla pantalla por pantalla ni acordarse de ponerla en las nuevas: una
 * pantalla sin ficha simplemente no muestra el boton.
 *
 * El panel se dibuja con un portal al body y NO donde vive el boton. La barra
 * superior usa backdrop-blur, y backdrop-filter convierte al elemento en el
 * marco de referencia de todo lo que sea fixed adentro: el panel se medía
 * contra los 56 pixeles de alto de la barra en vez de contra la ventana, y
 * salia recortado a una tira. El portal lo saca de ese marco.
 */
export function BotonAyuda() {
  const ruta = usePathname();
  const ficha = ayudaDe(ruta ?? "/");
  const [abierto, setAbierto] = useState(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  // Escape cierra: es lo que el usuario intenta primero.
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [abierto]);

  // Al cambiar de pantalla se cierra: la ficha de la anterior ya no aplica.
  useEffect(() => { setAbierto(false); }, [ruta]);

  if (!ficha) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title={`Ayuda: ${ficha.titulo}`}
        className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <CircleHelp className="h-4 w-4" />
      </button>

      {abierto && montado
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex justify-end bg-slate-900/40"
              onClick={() => setAbierto(false)}
              role="dialog"
              aria-modal="true"
              aria-label={`Ayuda de ${ficha.titulo}`}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                className="h-full w-full max-w-xl overflow-y-auto bg-white px-6 py-5 text-left shadow-2xl"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">Ayuda</p>
                    <h2 className="text-lg font-semibold text-slate-900">{ficha.titulo}</h2>
                  </div>
                  <button
                    type="button" onClick={() => setAbierto(false)} aria-label="Cerrar ayuda"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <p className="mt-4 text-[0.9375rem] leading-relaxed text-slate-700">{ficha.que}</p>

                <section className="mt-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Qué puede hacer aquí
                  </h3>
                  <ul className="mt-2 grid gap-2">
                    {ficha.hacer.map((h, i) => (
                      <li key={i} className="relative pl-5 text-sm leading-relaxed text-slate-700">
                        <span className="absolute left-0 top-[0.6em] h-1.5 w-1.5 rounded-full bg-brand-500" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="mt-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cómo se conecta con el resto
                  </h3>
                  <ul className="mt-2 grid gap-2">
                    {ficha.flujo.map((f, i) => (
                      <li key={i} className="relative pl-5 text-sm leading-relaxed text-slate-600">
                        <span className="absolute left-0 top-[0.6em] h-1.5 w-1.5 rounded-full bg-slate-300" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </section>

                {ficha.campos?.length ? (
                  <section className="mt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Qué significa cada campo
                    </h3>
                    <dl className="mt-2 grid gap-2.5">
                      {ficha.campos.map((c, i) => (
                        <div key={i} className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                          <dt className="text-sm font-medium text-slate-900">{c.nombre}</dt>
                          <dd className="text-sm leading-relaxed text-slate-600">{c.explica}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {ficha.botones?.length ? (
                  <section className="mt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Qué hace cada botón
                    </h3>
                    <dl className="mt-2 grid gap-2.5">
                      {ficha.botones.map((b, i) => (
                        <div key={i} className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                          <dt className="text-sm font-medium text-slate-900">{b.nombre}</dt>
                          <dd className="text-sm leading-relaxed text-slate-600">{b.explica}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {ficha.tablaConfigurable ? (
                  <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Controles de la lista
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Son los mismos en todas las listas del sistema: activos, órdenes, almacén,
                      planes, requisiciones, compras y proveedores.
                    </p>
                    <dl className="mt-2.5 grid gap-2.5">
                      {CONTROLES_TABLA.map((c, i) => (
                        <div key={i} className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                          <dt className="text-sm font-medium text-slate-900">{c.nombre}</dt>
                          <dd className="text-sm leading-relaxed text-slate-600">{c.explica}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {ficha.noPuedo?.length ? (
                  <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Si el sistema le dice que no
                    </h3>
                    <dl className="mt-2 grid gap-3">
                      {ficha.noPuedo.map((n, i) => (
                        <div key={i}>
                          <dt className="text-sm font-medium text-slate-900">{n.sintoma}</dt>
                          <dd className="mt-0.5 text-sm leading-relaxed text-slate-700">{n.porque}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {ficha.preguntas?.length ? (
                  <section className="mt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Lo que más se pregunta
                    </h3>
                    <dl className="mt-2 grid gap-3.5">
                      {ficha.preguntas.map((p, i) => (
                        <div key={i} className="border-b border-slate-100 pb-3.5 last:border-0 last:pb-0">
                          <dt className="text-sm font-medium text-slate-900">{p.pregunta}</dt>
                          <dd className="mt-1 text-sm leading-relaxed text-slate-600">{p.respuesta}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                <AyudaConIa
                  pantalla={ruta ?? "/dashboard"}
                  sugerencias={[
                    // Las de esta pantalla, mas una que siempre aplica.
                    ...(ficha.noPuedo ?? []).slice(0, 2).map((n) => `${n.sintoma}, ¿por qué?`),
                    `¿Cómo empiezo en ${ficha.titulo.toLowerCase()}?`,
                  ]}
                />

                <p className="mt-6 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  Presione Escape o haga clic fuera para cerrar.
                </p>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
