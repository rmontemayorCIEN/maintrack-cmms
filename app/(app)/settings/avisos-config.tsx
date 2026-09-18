"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { EVENTOS, ETIQUETA_MODULO, type Modulo, type TipoEvento } from "@/lib/avisos/catalogo";
import type { ReglaEscalamiento } from "@/lib/avisos/reglas";

type Preferencias = {
  canales: string[]; tiposApagados: string[]; resumenDiario: boolean; resumenSemanal: boolean;
  horaInicio: string | null; horaFin: string | null; sitios: string[]; navegadorRechazado: boolean;
};
type Config = {
  canales: string[]; horaInicio: string; horaFin: string; anticipacionHoras: number; destinatariosAdmin: string[];
  resumenDiario: boolean; resumenSemanal: boolean; horaResumen: string; resumenSinPendientes: boolean; remitente: string | null;
  reglas: Record<string, Partial<ReglaEscalamiento>>; reglasVigentes: Record<string, ReglaEscalamiento>;
  disponibles: { correo: boolean; navegador: boolean };
  personas: Array<{ id: string; name: string; role: string }>;
};

const TIPOS = Object.keys(EVENTOS) as TipoEvento[];
const CATEGORIA = { OBLIGATORIO: "No se puede apagar", OPERATIVO: "Operativo", INFORMATIVO: "Informativo" } as const;

async function guardar(url: string, cuerpo: unknown) {
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
  return d;
}

/** Preferencias personales y, para administradores, cómo avisa la empresa. */
export function ConfigDeAvisos({ puedeEditar, sitios, supervisa }: { puedeEditar: boolean; sitios: Array<{ id: string; name: string }>; supervisa: boolean }) {
  const [pref, setPref] = useState<Preferencias | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ de: string; texto: string; error?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/avisos/preferencias").then((r) => r.json()).then(setPref).catch(() => undefined);
    if (puedeEditar) fetch("/api/avisos/configuracion").then((r) => r.json()).then(setCfg).catch(() => undefined);
  }, [puedeEditar]);

  async function guardarPref() {
    if (!pref) return;
    setOcupado("pref"); setMensaje(null);
    try {
      const d = await guardar("/api/avisos/preferencias", {
        canales: pref.canales, tiposApagados: pref.tiposApagados, resumenDiario: pref.resumenDiario, resumenSemanal: pref.resumenSemanal,
        horaInicio: pref.horaInicio || null, horaFin: pref.horaFin || null, sitios: pref.sitios,
      });
      setMensaje({ de: "pref", texto: d.ignorados?.length ? "Guardado. Los avisos obligatorios se quedan encendidos." : "Preferencias guardadas." });
    } catch (e) {
      setMensaje({ de: "pref", texto: (e as Error).message, error: true });
    } finally { setOcupado(null); }
  }

  async function guardarCfg() {
    if (!cfg) return;
    setOcupado("cfg"); setMensaje(null);
    try {
      const reglas = Object.fromEntries(Object.entries(cfg.reglasVigentes).map(([k, r]) => [k, { esperaMin: r.esperaMin, soloJornada: r.soloJornada, maxRecordatorios: r.maxRecordatorios, activa: r.activa }]));
      await guardar("/api/avisos/configuracion", {
        canales: cfg.canales, horaInicio: cfg.horaInicio, horaFin: cfg.horaFin, anticipacionHoras: cfg.anticipacionHoras,
        destinatariosAdmin: cfg.destinatariosAdmin, resumenDiario: cfg.resumenDiario, resumenSemanal: cfg.resumenSemanal,
        horaResumen: cfg.horaResumen, resumenSinPendientes: cfg.resumenSinPendientes, remitente: cfg.remitente, reglas,
      });
      setMensaje({ de: "cfg", texto: "Configuración de la empresa guardada." });
    } catch (e) {
      setMensaje({ de: "cfg", texto: (e as Error).message, error: true });
    } finally { setOcupado(null); }
  }

  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const aviso = (de: string) => mensaje?.de === de
    ? <p className={`text-xs ${mensaje.error ? "text-red-700" : "text-emerald-700"}`}>{mensaje.texto}</p> : null;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Mis avisos" subtitle="Qué le llega a usted y por dónde. El centro de avisos siempre recibe todo lo que le toca." />
        {!pref ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
          <div className="grid gap-4 text-xs">
            <div>
              <p className="mb-1 font-semibold text-slate-700">Canales</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={pref.canales.includes("NAVEGADOR")} onChange={() => setPref({ ...pref, canales: alternar(pref.canales, "NAVEGADOR") })} />
                  Aviso en el celular o el navegador
                  {pref.navegadorRechazado ? <span className="text-amber-700">(el navegador negó el permiso; se reactiva arriba)</span> : null}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={pref.canales.includes("CORREO")} onChange={() => setPref({ ...pref, canales: alternar(pref.canales, "CORREO") })} />
                  Correo electrónico
                </label>
              </div>
              <p className="mt-1 text-[0.6875rem] text-slate-500">Los avisos no críticos llegan dentro de su horario; los críticos, a cualquier hora. Si un canal falla, el aviso sigue en el centro de avisos.</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">Avisos no críticos desde
                <input type="time" className="field py-1 text-xs" value={pref.horaInicio ?? ""} onChange={(e) => setPref({ ...pref, horaInicio: e.target.value || null })} placeholder="El de la empresa" />
              </label>
              <label className="grid gap-1">hasta
                <input type="time" className="field py-1 text-xs" value={pref.horaFin ?? ""} onChange={(e) => setPref({ ...pref, horaFin: e.target.value || null })} />
              </label>
              <p className="text-[0.6875rem] text-slate-500 sm:col-span-2">Vacío: el horario de la empresa.</p>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={pref.resumenDiario} onChange={(e) => setPref({ ...pref, resumenDiario: e.target.checked })} /> Resumen diario</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={pref.resumenSemanal} onChange={(e) => setPref({ ...pref, resumenSemanal: e.target.checked })} /> Resumen semanal</label>
            </div>

            {supervisa && sitios.length > 1 ? (
              <div>
                <p className="mb-1 font-semibold text-slate-700">Sitios de interés</p>
                <div className="flex flex-wrap gap-3">
                  {sitios.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={pref.sitios.includes(s.id)} onChange={() => setPref({ ...pref, sitios: alternar(pref.sitios, s.id) })} /> {s.name}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-500">Sin marcar ninguno recibe los de todos los sitios. Si en un sitio no hay nadie más, le llega de todos modos.</p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 font-semibold text-slate-700">Tipos de aviso</p>
              <div className="grid gap-3 md:grid-cols-2">
                {(Object.keys(ETIQUETA_MODULO) as Modulo[]).map((m) => {
                  const tipos = TIPOS.filter((t) => EVENTOS[t].modulo === m && m !== "RESUMENES");
                  if (!tipos.length) return null;
                  return (
                    <div key={m} className="rounded-lg border border-slate-200 p-2">
                      <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{ETIQUETA_MODULO[m]}</p>
                      {tipos.map((t) => {
                        const d = EVENTOS[t];
                        const fijo = d.categoria === "OBLIGATORIO";
                        return (
                          <label key={t} className="flex items-start gap-1.5 py-0.5" title={d.quien}>
                            <input type="checkbox" className="mt-0.5" disabled={fijo} checked={fijo || !pref.tiposApagados.includes(t)}
                              onChange={() => setPref({ ...pref, tiposApagados: alternar(pref.tiposApagados, t) })} />
                            <span>
                              <span className="font-medium text-slate-700">{d.titulo}</span>
                              {fijo ? <span className="ml-1 inline-flex items-center gap-0.5 text-[0.625rem] text-slate-400"><Lock className="h-2.5 w-2.5" /> {CATEGORIA.OBLIGATORIO}</span> : null}
                              <span className="block text-[0.6875rem] text-slate-500">{d.descripcion}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-[0.6875rem] text-slate-500">Aunque apague un tipo, le seguirá llegando si usted es el responsable directo de algo alto o crítico, o la única persona que puede atenderlo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={guardarPref} disabled={ocupado !== null}>{ocupado === "pref" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar mis avisos</Button>
              {aviso("pref")}
            </div>
          </div>
        )}
      </Card>

      {puedeEditar ? (
        <Card>
          <CardHeader title="Cómo avisa la empresa" subtitle="Rige para todos. Viene con valores recomendados: no hace falta tocar nada para empezar." />
          {!cfg ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
            <div className="grid gap-4 text-xs">
              <div>
                <p className="mb-1 font-semibold text-slate-700">Canales</p>
                <div className="flex flex-wrap gap-4">
                  {([["NAVEGADOR", "Celular y navegador", cfg.disponibles.navegador], ["CORREO", "Correo", cfg.disponibles.correo], ["WEBHOOK", "Webhooks", true]] as const).map(([c, t, ok]) => (
                    <label key={c} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={cfg.canales.includes(c)} onChange={() => setCfg({ ...cfg, canales: alternar(cfg.canales, c) })} /> {t}
                      {!ok ? <Badge tone="muted">{c === "CORREO" ? "sin proveedor configurado" : "apagado arriba"}</Badge> : null}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-500">El centro de avisos no se apaga. Un canal apagado deja de usarse; nada se pierde.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1">Avisos no críticos desde<input type="time" className="field py-1 text-xs" value={cfg.horaInicio} onChange={(e) => setCfg({ ...cfg, horaInicio: e.target.value })} /></label>
                <label className="grid gap-1">hasta<input type="time" className="field py-1 text-xs" value={cfg.horaFin} onChange={(e) => setCfg({ ...cfg, horaFin: e.target.value })} /></label>
                <label className="grid gap-1">Avisar vencimientos con (horas)<input type="number" inputMode="decimal" min={1} max={336} className="field py-1 text-xs" value={cfg.anticipacionHoras} onChange={(e) => setCfg({ ...cfg, anticipacionHoras: Number(e.target.value) })} /></label>
              </div>
              <p className="-mt-2 text-[0.6875rem] text-slate-500">En la zona y los días laborables de la empresa (Configuración → Jornada). Fuera de la ventana, lo no crítico espera a que abra.</p>

              <div>
                <p className="mb-1 font-semibold text-slate-700">Destinatarios administrativos</p>
                <div className="flex flex-wrap gap-3">
                  {cfg.personas.filter((p) => p.role !== "SUPERVISOR").map((p) => (
                    <label key={p.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={cfg.destinatariosAdmin.includes(p.id)} onChange={() => setCfg({ ...cfg, destinatariosAdmin: alternar(cfg.destinatariosAdmin, p.id) })} /> {p.name}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-500">Reciben avisos de cuenta, integraciones y configuración incompleta. Sin marcar: el dueño y los administradores.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.resumenDiario} onChange={(e) => setCfg({ ...cfg, resumenDiario: e.target.checked })} /> Resumen diario</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.resumenSemanal} onChange={(e) => setCfg({ ...cfg, resumenSemanal: e.target.checked })} /> Resumen semanal (primer día laborable)</label>
                <label className="grid gap-1">Hora del resumen<input type="time" className="field py-1 text-xs" value={cfg.horaResumen} onChange={(e) => setCfg({ ...cfg, horaResumen: e.target.value })} /></label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.resumenSinPendientes} onChange={(e) => setCfg({ ...cfg, resumenSinPendientes: e.target.checked })} /> Mandarlo aunque no haya pendientes</label>
              </div>

              <div>
                <p className="mb-1 font-semibold text-slate-700">Recordatorios y escalamiento</p>
                <div className="table-wrap rounded-lg border border-slate-200">
                  <table className="data">
                    <thead><tr><th>Regla</th><th>Primero a</th><th>Luego a</th><th>Espera (min)</th><th>Recordatorios</th><th>Solo en jornada</th><th>Activa</th></tr></thead>
                    <tbody>
                      {Object.entries(cfg.reglasVigentes).map(([k, r]) => {
                        const cambiar = (c: Partial<ReglaEscalamiento>) => setCfg({ ...cfg, reglasVigentes: { ...cfg.reglasVigentes, [k]: { ...r, ...c } } });
                        return (
                          <tr key={k}>
                            <td className="max-w-56"><p className="font-medium text-slate-700">{r.titulo}</p><p className="text-[0.6875rem] text-slate-500">{r.cuando} Se detiene: {r.seDetiene.toLowerCase()}</p></td>
                            <td className="text-[0.6875rem]">{r.primerNivel.map(nombreGrupo).join(", ")}</td>
                            <td className="text-[0.6875rem]">{r.siguienteNivel.map(nombreGrupo).join(", ")}</td>
                            <td><input type="number" inputMode="decimal" min={5} max={10080} className="field w-20 py-1 text-xs" value={r.esperaMin} onChange={(e) => cambiar({ esperaMin: Number(e.target.value) })} /></td>
                            <td><input type="number" inputMode="decimal" min={0} max={10} className="field w-16 py-1 text-xs" value={r.maxRecordatorios} onChange={(e) => cambiar({ maxRecordatorios: Number(e.target.value) })} /></td>
                            <td><input type="checkbox" checked={r.soloJornada} onChange={(e) => cambiar({ soloJornada: e.target.checked })} /></td>
                            <td><input type="checkbox" checked={r.activa} onChange={(e) => cambiar({ activa: e.target.checked })} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-500">Cada recordatorio vuelve a entregar el mismo aviso; no se acumulan avisos iguales. Al subir de nivel queda en la bitácora.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={guardarCfg} disabled={ocupado !== null}>{ocupado === "cfg" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar configuración de la empresa</Button>
                {aviso("cfg")}
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function nombreGrupo(g: string): string {
  return ({
    RESPONSABLE: "responsable", SUPERVISORES: "supervisores", ADMINISTRADORES: "administración", REVISORES: "quien revisa solicitudes",
    AUTORIZADORES: "quien autoriza compras", PROPIETARIO: "dueño", ALMACEN: "almacén", COMPRAS: "compras",
  } as Record<string, string>)[g] ?? g.toLowerCase();
}
