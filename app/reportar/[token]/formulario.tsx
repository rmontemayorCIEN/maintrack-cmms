"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, Check, Loader2, X } from "lucide-react";
import { CampoTitulo } from "@/components/campo-titulo";

const LIMITE_MB = 5;

/**
 * Formulario publico de reporte.
 *
 * Pensado para el telefono y para alguien que nunca ha visto el sistema: sin
 * jerga de mantenimiento, sin campos que obliguen a saber como se llama el
 * equipo —eso ya lo trae el codigo— y con la camara a un toque.
 */
export function FormularioReporte({
  token, empresa, lugar,
}: {
  token: string;
  /** Nulo cuando el punto no muestra el nombre de la empresa. */
  empresa: string | null;
  lugar: string | null;
}) {
  const archivo = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [correo, setCorreo] = useState("");
  const [foto, setFoto] = useState<{ base64: string; tipo: string; vista: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ numero: string; seguimiento: string; fotoGuardada: boolean | null } | null>(null);

  async function tomarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > LIMITE_MB * 1024 * 1024) {
      setError(`La foto pesa más de ${LIMITE_MB} MB. Tome una nueva con menos calidad.`);
      return;
    }
    const base64 = await new Promise<string>((res, rej) => {
      const l = new FileReader();
      l.onload = () => res(String(l.result).split(",")[1] ?? "");
      l.onerror = () => rej(new Error("no se pudo leer"));
      l.readAsDataURL(f);
    });
    setError(null);
    setFoto({ base64, tipo: f.type, vista: URL.createObjectURL(f) });
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setError(null);
    const res = await fetch("/api/publico", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "REPORTAR", punto: token, titulo, descripcion: descripcion || null,
        nombre, celular, correo: correo || null,
        foto: foto ? { base64: foto.base64, tipo: foto.tipo } : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setEnviando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible enviar el reporte"); return; }
    setListo({ numero: data.numero, seguimiento: data.seguimiento, fotoGuardada: data.fotoGuardada ?? null });
  }

  if (listo) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-600">
          <Check className="h-6 w-6 text-white" />
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Reporte enviado</h2>
        <p className="mt-1 text-sm text-slate-700">
          Mantenimiento ya fue notificado. Su folio es:
        </p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-wide text-emerald-900">{listo.numero}</p>

        {listo.fotoGuardada === false ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Su reporte sí quedó registrado, pero <strong>la foto no se pudo adjuntar</strong>. Si es
            importante, vuelva a intentarlo desde «Ver cómo va mi reporte».
          </p>
        ) : null}

        <div className="mt-4 grid gap-2">
          <Link
            href={`/solicitud/${listo.seguimiento}`}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
          >
            Ver cómo va mi reporte
          </Link>
          <Link
            href="/mis-reportes"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
          >
            Ver todos mis reportes
          </Link>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          Este teléfono ya quedó reconocido: puede volver a <strong>Mis reportes</strong> cuando
          quiera, sin teclear nada. Si entra desde otro dispositivo, use{" "}
          <Link href="/consultar" className="font-medium text-emerald-800 underline">
            consultar mi reporte
          </Link>{" "}
          con su folio y su celular.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="grid gap-4">
      <div>
        <label className="text-sm font-medium text-slate-800">¿Qué está pasando? *</label>
        <CampoTitulo
          value={titulo} onChange={setTitulo} required minLength={5} maxLength={140}
          placeholder="El aire no enfría, gotea una llave, no prende la luz…"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-800">Cuéntenos más</label>
        <textarea
          value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={1000}
          placeholder="Desde cuándo, si hace ruido, si ya había pasado antes…"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-800">Una foto ayuda mucho</label>
        <input ref={archivo} type="file" accept="image/*" capture="environment" onChange={tomarFoto} className="hidden" />
        {foto ? (
          <div className="mt-1 flex items-center gap-3 rounded-lg border border-slate-200 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={foto.vista} alt="Foto del reporte" className="h-16 w-16 rounded object-cover" />
            <span className="flex-1 text-sm text-slate-600">Foto lista</span>
            <button type="button" onClick={() => setFoto(null)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button" onClick={() => archivo.current?.click()}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600"
          >
            <Camera className="h-5 w-5" /> Tomar foto
          </button>
        )}
      </div>

      <div className="grid gap-4 rounded-lg bg-slate-50 p-4">
        <p className="text-xs text-slate-600">
          Necesitamos saber quién reporta para poder llamarle si hace falta un dato más.
        </p>
        <div>
          <label className="text-sm font-medium text-slate-800">Su nombre *</label>
          <input
            value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={3} maxLength={120}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-800">Su celular *</label>
          <input
            type="tel" inputMode="tel" value={celular} onChange={(e) => setCelular(e.target.value)}
            required minLength={7} maxLength={24} placeholder="81 1234 5678"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-800">Correo <span className="font-normal text-slate-400">(opcional)</span></label>
          <input
            type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} maxLength={160}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>
      ) : null}

      <button
        type="submit" disabled={enviando}
        className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50"
      >
        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Enviar reporte {lugar ? `de ${lugar}` : ""}
      </button>

      <p className="text-center text-[0.6875rem] text-slate-400">
        Su reporte llega a mantenimiento{empresa ? ` de ${empresa}` : " de esta instalación"}. No se crea ninguna cuenta.
      </p>
    </form>
  );
}
