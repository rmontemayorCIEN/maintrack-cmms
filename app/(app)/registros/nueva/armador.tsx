"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { IconoMenu } from "@/components/shell/iconos";
import { ROLE_LABELS } from "@/lib/constants";
import { ROLES } from "@/lib/pantallas";
import { PLANTILLAS, type Plantilla } from "@/lib/registros-plantillas";
import {
  LIMITES, ORDEN_TIPOS_CAMPO, PERMISOS_DE_TABLA, TIPOS_CAMPO, definicionDeCampo,
  problemasDeDefinicion, textoDeOpciones, type TipoCampo,
} from "@/lib/registros-tipos";

/**
 * Armar una tabla propia.
 *
 * Arranca en los formatos ya hechos y deja «en blanco» al final a proposito:
 * quien empieza en una pantalla vacia pone tres columnas de texto, ninguna
 * explicacion, y a los dos meses la tabla tiene «Bomba 3», «bomba tres» y
 * «B-3» como si fueran equipos distintos. Un formato entrega el caso ya
 * pensado —con las columnas amarradas a los datos de verdad— y se ajusta antes
 * de guardar.
 *
 * Importa de `registros-tipos` y NO de `registros`: esto corre en el
 * navegador, y el modulo con la logica arrastra prisma.
 */

type CampoEnEdicion = {
  etiqueta: string;
  tipo: TipoCampo;
  descripcion: string;
  requerido: boolean;
  enLista: boolean;
  opciones: string;
};

const vacio = (): CampoEnEdicion => ({
  etiqueta: "", tipo: "TEXTO", descripcion: "", requerido: false, enLista: true, opciones: "",
});

const dePlantilla = (p: Plantilla): CampoEnEdicion[] =>
  p.campos.map((c) => ({
    etiqueta: c.etiqueta, tipo: c.tipo, descripcion: "",
    requerido: Boolean(c.requerido), enLista: c.enLista ?? true,
    opciones: c.opciones ? textoDeOpciones(c.opciones) : "",
  }));

/** Los tipos partidos en dos: lo que todos entienden, y lo que apunta a sus datos. */
const TIPOS_BASICOS = ORDEN_TIPOS_CAMPO.filter((t) => !TIPOS_CAMPO[t].llave);
const TIPOS_LLAVE = ORDEN_TIPOS_CAMPO.filter((t) => TIPOS_CAMPO[t].llave);

const etiquetaCampo = "block text-xs font-medium text-slate-600";
const entrada = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

export function Armador() {
  const router = useRouter();
  const [elegida, setElegida] = useState<Plantilla | null>(null);
  const [enBlanco, setEnBlanco] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [permiso, setPermiso] = useState<string>("workorder:execute");
  const [roles, setRoles] = useState<string[]>(["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "VIEWER"]);
  const [campos, setCampos] = useState<CampoEnEdicion[]>([]);
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const arrancar = (p: Plantilla | null) => {
    setElegida(p);
    setEnBlanco(p === null);
    setNombre(p?.nombre ?? "");
    setDescripcion(p?.descripcion ?? "");
    setCampos(p ? dePlantilla(p) : [vacio()]);
    setErrores([]);
  };

  const cambiar = (i: number, cambios: Partial<CampoEnEdicion>) =>
    setCampos((cs) => cs.map((c, j) => (j === i ? { ...c, ...cambios } : c)));

  const mover = (i: number, hacia: number) =>
    setCampos((cs) => {
      const j = i + hacia;
      if (j < 0 || j >= cs.length) return cs;
      const copia = [...cs];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });

  async function guardar() {
    const problemas = problemasDeDefinicion({
      nombre, descripcion,
      campos: campos.map((c) => ({ etiqueta: c.etiqueta, tipo: c.tipo, opciones: c.opciones })),
    });
    if (problemas.length) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      const r = await fetch("/api/registros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre, descripcion, permiso, rolesVer: roles,
          plantilla: elegida?.clave ?? null,
          icono: elegida?.icono ?? null,
          campos: campos.map((c) => ({
            etiqueta: c.etiqueta, tipo: c.tipo,
            descripcion: c.descripcion || null,
            requerido: c.requerido, enLista: c.enLista,
            opciones: c.tipo === "LISTA" ? c.opciones.split("\n").map((o) => o.trim()).filter(Boolean) : null,
          })),
        }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Los motivos vienen en lista: se corrige una tabla de doce campos sin adivinar.
        setErrores(Array.isArray(datos.details) ? datos.details : [datos.error ?? "No se pudo guardar."]);
        return;
      }
      router.push(`/registros/${datos.tabla.clave}`);
    } finally {
      setGuardando(false);
    }
  }

  // ── Paso 1: de donde arranca
  if (!elegida && !enBlanco) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-600">
          Empiece por un formato ya hecho y ajústelo. Cada uno trae sus columnas amarradas a sus equipos, su
          personal y sus proveedores, y su explicación ya escrita —que es lo que después lee la ayuda y la IA
          para poder contestar sobre esta tabla—.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLANTILLAS.map((p) => (
            <button
              key={p.clave} type="button" onClick={() => arrancar(p)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-500"><IconoMenu nombre={p.icono} className="h-4 w-4" /></span>
                <span className="font-medium text-slate-800">{p.nombre}</span>
              </div>
              <p className="mt-2 text-xs text-slate-600">{p.descripcion}</p>
              {/* Por que no es un modulo del sistema: es la pregunta que se hace
                  quien duda si esto va aqui o ya existe en otra pantalla. */}
              <p className="mt-2 border-t border-slate-100 pt-2 text-[0.6875rem] text-slate-400">{p.porQue}</p>
              <p className="mt-2 text-[0.6875rem] text-slate-500">{p.campos.length} columnas</p>
            </button>
          ))}
          <button
            type="button" onClick={() => arrancar(null)}
            className="rounded-xl border border-dashed border-slate-300 p-4 text-left transition hover:border-slate-400"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-slate-500" aria-hidden />
              <span className="font-medium text-slate-800">En blanco</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Para un control que no se parece a ninguno de los de arriba. Va a pedirle que explique para qué es
              y que elija el tipo de cada columna.
            </p>
          </button>
        </div>
      </div>
    );
  }

  // ── Paso 2: ajustar
  return (
    <div className="space-y-4">
      <button type="button" onClick={() => { setElegida(null); setEnBlanco(false); }} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Cambiar de formato
      </button>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={etiquetaCampo} htmlFor="nombre">Cómo se llama</label>
            <input id="nombre" className={entrada} value={nombre} maxLength={LIMITES.largoNombre}
              onChange={(e) => setNombre(e.target.value)} placeholder="Bitácora de diésel" />
          </div>
          <div>
            <label className={etiquetaCampo} htmlFor="permiso">Quién puede capturar</label>
            <select id="permiso" className={entrada} value={permiso} onChange={(e) => setPermiso(e.target.value)}>
              {PERMISOS_DE_TABLA.map((p) => <option key={p.permiso} value={p.permiso}>{p.etiqueta}</option>)}
            </select>
            <p className="mt-1 text-[0.6875rem] text-slate-500">
              {PERMISOS_DE_TABLA.find((p) => p.permiso === permiso)?.explica}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <label className={etiquetaCampo} htmlFor="descripcion">Para qué es</label>
          <textarea id="descripcion" className={entrada} rows={3} value={descripcion} maxLength={LIMITES.largoDescripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Cada carga de diésel a un equipo, con litros e importe, para ver el rendimiento por equipo." />
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            No es un adorno: es lo que lee la ayuda de esta pantalla y lo que le permite a la IA contestar
            preguntas sobre esta tabla. Una tabla sin explicación queda muda.
          </p>
        </div>

        <div className="mt-3">
          <span className={etiquetaCampo}>Quién la ve</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {ROLES.map((r) => {
              const puesto = roles.includes(r);
              return (
                <button
                  key={r} type="button"
                  onClick={() => setRoles((rs) => (puesto ? rs.filter((x) => x !== r) : [...rs, r]))}
                  className={`rounded-full border px-3 py-1 text-xs ${puesto ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 text-slate-600"}`}
                >
                  {ROLE_LABELS[r] ?? r}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[0.6875rem] text-slate-500">
            Ver y capturar son distintos: el técnico puede ver una tabla que solo administración llena.
          </p>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Columnas</span>
          <span className="text-[0.6875rem] text-slate-400 tabular-nums">{campos.length} de {LIMITES.camposPorTabla}</span>
        </div>

        <div className="space-y-3">
          {campos.map((c, i) => {
            const def = definicionDeCampo(c.tipo);
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label className={etiquetaCampo}>Nombre de la columna</label>
                    <input className={entrada} value={c.etiqueta} maxLength={LIMITES.largoNombre}
                      onChange={(e) => cambiar(i, { etiqueta: e.target.value })} placeholder="Litros" />
                  </div>
                  <div>
                    <label className={etiquetaCampo}>Qué guarda</label>
                    <select className={entrada} value={c.tipo}
                      onChange={(e) => cambiar(i, { tipo: e.target.value as TipoCampo })}>
                      <optgroup label="Datos sueltos">
                        {TIPOS_BASICOS.map((t) => <option key={t} value={t}>{TIPOS_CAMPO[t].nombre}</option>)}
                      </optgroup>
                      {/* Estas son las que hacen que no sea un Excel. */}
                      <optgroup label="De sus datos de MainTrack">
                        {TIPOS_LLAVE.map((t) => <option key={t} value={t}>{TIPOS_CAMPO[t].nombre}</option>)}
                      </optgroup>
                    </select>
                  </div>
                  <div className="flex items-end gap-1">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
                      className="rounded border border-slate-300 p-2 text-slate-500 disabled:opacity-30" aria-label="Subir">
                      <GripVertical className="h-3 w-3" aria-hidden />
                    </button>
                    <button type="button" onClick={() => setCampos((cs) => cs.filter((_, j) => j !== i))}
                      className="rounded border border-slate-300 p-2 text-slate-500 hover:text-rose-600" aria-label="Quitar columna">
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                </div>

                <p className="mt-1 text-[0.6875rem] text-slate-500">{def.descripcion}</p>

                {def.pideOpciones ? (
                  <div className="mt-2">
                    <label className={etiquetaCampo}>Las opciones, una por renglón</label>
                    <textarea className={entrada} rows={3} value={c.opciones}
                      onChange={(e) => cambiar(i, { opciones: e.target.value })}
                      placeholder={"Matutino\nVespertino\nNocturno"} />
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={c.requerido} onChange={(e) => cambiar(i, { requerido: e.target.checked })} />
                    No se puede dejar vacía
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={c.enLista} onChange={(e) => cambiar(i, { enLista: e.target.checked })} />
                    Se ve en la lista
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {campos.length < LIMITES.camposPorTabla ? (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCampos((cs) => [...cs, vacio()])}>
            <Plus className="mr-1 h-3 w-3" aria-hidden /> Agregar columna
          </Button>
        ) : (
          <p className="mt-3 text-[0.6875rem] text-slate-500">
            Ya son {LIMITES.camposPorTabla} columnas, que es el límite. Una tabla más ancha no se lee en un teléfono.
          </p>
        )}
      </Card>

      {errores.length ? (
        <Card>
          <p className="text-sm font-medium text-rose-700">Falta corregir esto:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-600">
            {errores.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      ) : null}

      <div className="flex items-center gap-2">
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Crear la tabla"}
        </Button>
        <p className="text-[0.6875rem] text-slate-500">
          Después se pueden agregar columnas y cambiarles el nombre. Lo que no cambia es el tipo de una columna
          que ya tiene datos.
        </p>
      </div>
    </div>
  );
}
