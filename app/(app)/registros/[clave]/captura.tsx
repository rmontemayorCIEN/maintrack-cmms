"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { SelectorBuscable, type OpcionBuscable } from "@/components/selector-buscable";
import { definicionDeCampo, opcionesDe, type Llave } from "@/lib/registros-tipos";

/**
 * Capturar un renglon en una tabla propia.
 *
 * El formulario se arma solo a partir de las columnas: cada tipo sabe con que
 * control se captura. Las columnas que apuntan a los datos de MainTrack usan
 * el mismo buscador que el resto del sistema —no un desplegable con
 * doscientos equipos— y ninguna arranca con algo preseleccionado: una
 * refaccion preseleccionada en la orden de trabajo movia inventario con un solo
 * toque involuntario, y esa leccion aplica igual aqui.
 */

export type CampoParaCapturar = {
  id: string;
  clave: string;
  etiqueta: string;
  tipo: string;
  descripcion: string | null;
  requerido: boolean;
  opciones: string | null;
};

const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

export function Captura({
  tablaId,
  campos,
  catalogos,
}: {
  tablaId: string;
  campos: CampoParaCapturar[];
  catalogos: Partial<Record<Llave, OpcionBuscable[]>>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const poner = (clave: string, valor: string) => setValores((v) => ({ ...v, [clave]: valor }));

  function limpiar() {
    setValores({});
    setErrores([]);
  }

  async function guardar() {
    setGuardando(true);
    setErrores([]);
    try {
      const r = await fetch(`/api/registros/${tablaId}/renglones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valores }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrores(Array.isArray(datos.details) ? datos.details : [datos.error ?? "No se pudo guardar."]);
        return;
      }
      limpiar();
      setAbierto(false);
      router.refresh();
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <Button onClick={() => setAbierto(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden /> Capturar
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Nuevo renglón</span>
        <button type="button" onClick={() => { setAbierto(false); limpiar(); }}
          className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campos.map((campo) => {
          const def = definicionDeCampo(campo.tipo);
          const valor = valores[campo.clave] ?? "";
          const id = `c-${campo.id}`;
          return (
            <div key={campo.id} className={def.columna === "texto" && campo.tipo === "TEXTO_LARGO" ? "sm:col-span-2" : undefined}>
              <label className="block text-xs font-medium text-slate-600" htmlFor={id}>
                {campo.etiqueta}
                {campo.requerido ? <span className="text-rose-500"> *</span> : null}
              </label>

              {def.llave ? (
                <SelectorBuscable
                  valor={valor}
                  onCambio={(v) => poner(campo.clave, v)}
                  opciones={catalogos[def.llave] ?? []}
                  vacio={campo.requerido ? null : "Sin seleccionar"}
                />
              ) : campo.tipo === "LISTA" ? (
                <select id={id} className={entrada} value={valor} onChange={(e) => poner(campo.clave, e.target.value)}>
                  <option value="">Sin seleccionar</option>
                  {opcionesDe(campo.opciones).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : campo.tipo === "SI_NO" ? (
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input id={id} type="checkbox" checked={valor === "true"}
                    onChange={(e) => poner(campo.clave, e.target.checked ? "true" : "false")} />
                  Sí
                </label>
              ) : campo.tipo === "TEXTO_LARGO" ? (
                <textarea id={id} className={entrada} rows={3} value={valor} onChange={(e) => poner(campo.clave, e.target.value)} />
              ) : (
                <input
                  id={id} className={entrada} value={valor}
                  type={def.columna === "fecha" ? "date" : def.columna === "numero" ? "text" : "text"}
                  inputMode={def.columna === "numero" ? "decimal" : undefined}
                  onChange={(e) => poner(campo.clave, e.target.value)}
                />
              )}

              {campo.descripcion ? <p className="mt-1 text-[0.6875rem] text-slate-500">{campo.descripcion}</p> : null}
            </div>
          );
        })}
      </div>

      {errores.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-600">
          {errores.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar renglón"}</Button>
        <Button variant="secondary" onClick={limpiar} disabled={guardando}>Limpiar</Button>
      </div>
    </Card>
  );
}
