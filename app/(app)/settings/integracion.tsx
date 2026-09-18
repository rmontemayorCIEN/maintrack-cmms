"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { useZona } from "@/components/zona-empresa";
import { formatDateTime } from "@/lib/utils";
import { ALCANCES, type Alcance } from "@/lib/integraciones/alcances";
import { EVENTOS, EVENTOS_WEBHOOK, ETIQUETA_ESTADO_ENTREGA, type EstadoEntrega } from "@/lib/avisos/catalogo";

type Credencial = { id: string; nombre: string; mascara: string; alcances: string[]; estado: string; expiraEl: string | null; ultimoUsoEl: string | null; usos: number; createdAt: string };
type Webhook = { id: string; nombre: string; url: string; eventos: string[]; estado: string; secreto: string; ultimoEnvioEl: string | null; ultimoResultado: string | null; fallasConsecutivas: number };
type Entrega = { id: string; tipo: string; canal: string; estado: EstadoEntrega; intentos: number; errorCategoria: string | null; errorDetalle: string | null; proximoIntento: string | null; destinatario: string; resumen: string | null; createdAt: string; proveedor: string | null };
type Estado = {
  canales: Record<string, { disponible: boolean; motivo?: string | null; proveedor?: string | null }>;
  entregas: { fallidas24h: number; enCola: number; sinDestinatario7d: number };
  webhooks: Record<string, number>; credenciales: Record<string, number>; api: { rechazos24h: number };
};

const TONO_ENTREGA: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  ENTREGADA: "success", FALLIDA: "danger", EN_REINTENTO: "warning", PENDIENTE: "info", EN_PROCESO: "info",
  CANCELADA: "muted", OMITIDA_PREFERENCIA: "muted", SIN_DESTINATARIO: "danger",
};

async function llamar(url: string, metodo: string, cuerpo?: unknown) {
  const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "No se pudo completar");
  return d;
}

/** Secreto recién creado: se muestra una vez, con botón de copiar. */
function SecretoUnaVez({ texto, alCerrar }: { texto: string; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">Cópielo ahora: no se volverá a mostrar.</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-[0.6875rem] text-slate-800">{texto}</code>
        <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(texto); setCopiado(true); }}>
          <Copy className="h-3.5 w-3.5" /> {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <button type="button" onClick={alCerrar} className="mt-2 text-[0.6875rem] underline">Ya lo guardé</button>
    </div>
  );
}

export function PanelIntegracion() {
  const zona = useZona();
  const [creds, setCreds] = useState<Credencial[] | null>(null);
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [entregas, setEntregas] = useState<Entrega[] | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [filtroEntregas, setFiltroEntregas] = useState("");
  const [secreto, setSecreto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nuevaCred, setNuevaCred] = useState({ nombre: "", alcances: [] as string[], expiraDias: "" });
  const [nuevoHook, setNuevoHook] = useState({ nombre: "", url: "", eventos: [] as string[] });

  const cargar = useCallback(async () => {
    const [c, w, e, s] = await Promise.all([
      llamar("/api/integraciones/credenciales", "GET").catch(() => ({ credenciales: [] })),
      llamar("/api/integraciones/webhooks", "GET").catch(() => ({ webhooks: [] })),
      llamar(`/api/avisos/entregas${filtroEntregas ? `?estado=${filtroEntregas}` : ""}`, "GET").catch(() => ({ entregas: [] })),
      llamar("/api/avisos/estado", "GET").catch(() => null),
    ]);
    setCreds(c.credenciales); setHooks(w.webhooks); setEntregas(e.entregas); setEstado(s);
  }, [filtroEntregas]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function accion(clave: string, fn: () => Promise<unknown>) {
    setOcupado(clave); setError(null);
    try { await fn(); await cargar(); } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }
  const alternar = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);

  return (
    <div className="grid gap-4">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {secreto ? <SecretoUnaVez texto={secreto} alCerrar={() => setSecreto(null)} /> : null}

      <Card>
        <CardHeader title="Estado de avisos e integraciones" subtitle="Si algo no está llegando, aquí se ve por qué." />
        {!estado ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries({ "Centro de avisos": estado.canales.centro, "Celular y navegador": estado.canales.navegador, Correo: estado.canales.correo }).map(([n, c]) => (
              <div key={n} className="rounded-lg border border-slate-200 p-2">
                <p className="text-[0.6875rem] text-slate-500">{n}</p>
                <Badge tone={c.disponible ? "success" : "muted"}>{c.disponible ? "Disponible" : "No disponible"}</Badge>
                {c.motivo ? <p className="mt-1 text-[0.6875rem] text-slate-500">{c.motivo}</p> : null}
              </div>
            ))}
            <div className="rounded-lg border border-slate-200 p-2">
              <p className="text-[0.6875rem] text-slate-500">Entregas</p>
              <p className={estado.entregas.fallidas24h ? "text-red-700" : "text-slate-700"}>{estado.entregas.fallidas24h} fallidas en 24 h</p>
              <p className="text-slate-600">{estado.entregas.enCola} en cola · {estado.entregas.sinDestinatario7d} sin destinatario (7 días)</p>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="API y credenciales" subtitle="Para que otro sistema consulte o registre datos de esta empresa. Cada credencial es solo de esta empresa y solo puede lo que se le permite." />
        <div className="grid gap-3 text-xs">
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
            <p className="font-semibold text-slate-700">Nueva credencial</p>
            <input className="field py-1 text-xs" placeholder="Qué sistema la usa (p. ej. «Pasarela de sensores»)" value={nuevaCred.nombre} onChange={(e) => setNuevaCred({ ...nuevaCred, nombre: e.target.value })} />
            <div className="grid gap-1 sm:grid-cols-2">
              {(Object.keys(ALCANCES) as Alcance[]).map((a) => (
                <label key={a} className="flex items-start gap-1.5">
                  <input type="checkbox" className="mt-0.5" checked={nuevaCred.alcances.includes(a)} onChange={() => setNuevaCred({ ...nuevaCred, alcances: alternar(nuevaCred.alcances, a) })} />
                  <span><span className="font-mono text-[0.6875rem]">{a}</span> — {ALCANCES[a]}</span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2">Vence en
              <input type="number" inputMode="decimal" min={1} max={730} className="field w-24 py-1 text-xs" placeholder="nunca" value={nuevaCred.expiraDias} onChange={(e) => setNuevaCred({ ...nuevaCred, expiraDias: e.target.value })} /> días
            </label>
            <div>
              <Button size="sm" disabled={ocupado !== null || nuevaCred.nombre.trim().length < 3 || !nuevaCred.alcances.length} onClick={() => accion("cred", async () => {
                const d = await llamar("/api/integraciones/credenciales", "POST", { nombre: nuevaCred.nombre, alcances: nuevaCred.alcances, expiraDias: nuevaCred.expiraDias ? Number(nuevaCred.expiraDias) : null });
                setSecreto(d.secreto); setNuevaCred({ nombre: "", alcances: [], expiraDias: "" });
              })}>Crear credencial</Button>
            </div>
          </div>
          {creds?.length ? (
            <div className="table-wrap rounded-lg border border-slate-200">
              <table className="data">
                <thead><tr><th>Nombre</th><th>Credencial</th><th>Permisos</th><th>Estado</th><th>Último uso</th><th /></tr></thead>
                <tbody>
                  {creds.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-700">{c.nombre}</td>
                      <td className="font-mono text-[0.6875rem]">{c.mascara}</td>
                      <td className="text-[0.6875rem] text-slate-600">{c.alcances.join(", ")}</td>
                      <td><Badge tone={c.estado === "ACTIVA" ? "success" : "muted"}>{c.estado.toLowerCase()}</Badge>{c.expiraEl ? <p className="text-[0.625rem] text-slate-400">vence {formatDateTime(c.expiraEl, zona)}</p> : null}</td>
                      <td className="text-[0.6875rem] text-slate-500">{c.ultimoUsoEl ? `${formatDateTime(c.ultimoUsoEl, zona)} · ${c.usos} usos` : "nunca"}</td>
                      <td className="text-right">
                        {c.estado === "ACTIVA" ? (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => accion(`rot-${c.id}`, async () => { const d = await llamar(`/api/integraciones/credenciales/${c.id}`, "POST", { accion: "rotar" }); setSecreto(d.secreto); })}>Rotar</Button>
                            <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => confirm(`¿Revocar «${c.nombre}»? El sistema que la usa dejará de tener acceso de inmediato.`) && accion(`rev-${c.id}`, () => llamar(`/api/integraciones/credenciales/${c.id}`, "POST", { accion: "revocar" }))}>Revocar</Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-slate-500">Todavía no hay credenciales.</p>}
          <p className="text-[0.6875rem] text-slate-500">
            Rutas en <code className="font-mono">/api/v1</code> (activos, ubicaciones, órdenes, solicitudes, lecturas, condiciones, inventario, estado y eventos entrantes). La documentación completa para quien integra está en <code className="font-mono">Docs/api-v1.md</code>.
            Rotar crea una credencial nueva con los mismos permisos y revoca la anterior al instante.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Webhooks" subtitle="MainTrack le avisa a otro sistema cuando pasa algo. Cada envío va firmado; si el destino falla se reintenta, y tras 10 fallas seguidas se suspende y se le avisa." />
        <div className="grid gap-3 text-xs">
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
            <p className="font-semibold text-slate-700">Nuevo webhook</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="field py-1 text-xs" placeholder="Nombre (p. ej. «ERP»)" value={nuevoHook.nombre} onChange={(e) => setNuevoHook({ ...nuevoHook, nombre: e.target.value })} />
              <input className="field py-1 text-xs" placeholder="https://…" value={nuevoHook.url} onChange={(e) => setNuevoHook({ ...nuevoHook, url: e.target.value })} />
            </div>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {EVENTOS_WEBHOOK.map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={nuevoHook.eventos.includes(t)} onChange={() => setNuevoHook({ ...nuevoHook, eventos: alternar(nuevoHook.eventos, t) })} /> {EVENTOS[t].titulo}
                </label>
              ))}
            </div>
            <p className="text-[0.6875rem] text-slate-500">Solo direcciones https públicas: no se permiten direcciones internas, IPs ni puertos bajos no estándar.</p>
            <div>
              <Button size="sm" disabled={ocupado !== null || nuevoHook.nombre.trim().length < 3 || !nuevoHook.url || !nuevoHook.eventos.length} onClick={() => accion("hook", async () => {
                const d = await llamar("/api/integraciones/webhooks", "POST", nuevoHook);
                setSecreto(d.secreto); setNuevoHook({ nombre: "", url: "", eventos: [] });
              })}>Crear webhook</Button>
            </div>
          </div>
          {hooks?.length ? (
            <div className="table-wrap rounded-lg border border-slate-200">
              <table className="data">
                <thead><tr><th>Nombre</th><th>Destino</th><th>Eventos</th><th>Estado</th><th>Último envío</th><th /></tr></thead>
                <tbody>
                  {hooks.map((w) => (
                    <tr key={w.id}>
                      <td className="font-medium text-slate-700">{w.nombre}<p className="font-mono text-[0.625rem] text-slate-400">firma {w.secreto}</p></td>
                      <td className="max-w-48 break-all text-[0.6875rem] text-slate-600">{w.url}</td>
                      <td className="text-[0.6875rem] text-slate-600">{w.eventos.length} evento(s)</td>
                      <td><Badge tone={w.estado === "ACTIVO" ? "success" : w.estado === "SUSPENDIDO" ? "danger" : "muted"}>{w.estado.toLowerCase()}</Badge>{w.fallasConsecutivas ? <p className="text-[0.625rem] text-red-600">{w.fallasConsecutivas} fallas seguidas</p> : null}</td>
                      <td className="text-[0.6875rem] text-slate-500">{w.ultimoEnvioEl ? `${formatDateTime(w.ultimoEnvioEl, zona)} · ${w.ultimoResultado ?? ""}` : "—"}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => accion(`p-${w.id}`, async () => {
                            const r = await llamar(`/api/integraciones/webhooks/${w.id}`, "POST", { accion: "probar" });
                            if (!r.ok) throw new Error(`La prueba falló: ${r.detalle}`);
                          })}>Probar</Button>
                          <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => accion(`e-${w.id}`, () => llamar(`/api/integraciones/webhooks/${w.id}`, "PATCH", { estado: w.estado === "ACTIVO" ? "PAUSADO" : "ACTIVO" }))}>
                            {w.estado === "ACTIVO" ? "Pausar" : "Activar"}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => confirm("¿Cambiar el secreto de firma? El receptor tendrá que usar el nuevo.") && accion(`s-${w.id}`, async () => { const d = await llamar(`/api/integraciones/webhooks/${w.id}`, "POST", { accion: "rotar" }); setSecreto(d.secreto); })}>Nuevo secreto</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-slate-500">Todavía no hay webhooks.</p>}
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Historial de entregas</h3>
            <p className="text-xs text-slate-500">Cada intento por correo, navegador o webhook. Sin el contenido de los avisos.</p>
          </div>
          <select className="field w-auto py-1 text-xs" value={filtroEntregas} onChange={(e) => setFiltroEntregas(e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(ETIQUETA_ESTADO_ENTREGA) as EstadoEntrega[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_ENTREGA[e]}</option>)}
          </select>
        </div>
        {!entregas ? <p className="px-5 pb-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></p> : entregas.length === 0 ? (
          <p className="px-5 pb-5 text-xs text-slate-500">Sin entregas con este filtro.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Fecha</th><th>Aviso</th><th>Canal</th><th>Destino</th><th>Estado</th><th>Intentos</th><th>Detalle</th><th /></tr></thead>
              <tbody>
                {entregas.map((e) => (
                  <tr key={e.id}>
                    <td className="text-[0.6875rem] text-slate-500">{formatDateTime(e.createdAt, zona)}</td>
                    <td className="max-w-48 text-[0.6875rem]">{e.resumen ?? e.tipo}</td>
                    <td className="text-[0.6875rem]">{e.canal.toLowerCase()}</td>
                    <td className="max-w-40 text-[0.6875rem] text-slate-600">{e.destinatario}</td>
                    <td><Badge tone={TONO_ENTREGA[e.estado] ?? "muted"}>{ETIQUETA_ESTADO_ENTREGA[e.estado] ?? e.estado}</Badge></td>
                    <td className="text-[0.6875rem] tabular-nums">{e.intentos}</td>
                    <td className="max-w-56 text-[0.6875rem] text-slate-500">
                      {e.errorCategoria ? `${e.errorCategoria.toLowerCase()}: ${e.errorDetalle ?? ""}` : e.proveedor ?? ""}
                      {e.proximoIntento ? <span className="block">reintento {formatDateTime(e.proximoIntento, zona)}</span> : null}
                    </td>
                    <td className="text-right">
                      {["FALLIDA", "CANCELADA"].includes(e.estado) && e.canal !== "CAMPANA" ? (
                        <button type="button" disabled={ocupado !== null} onClick={() => accion(`r-${e.id}`, () => llamar(`/api/avisos/entregas/${e.id}`, "POST"))}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50">
                          <RotateCcw className="h-3 w-3" /> Reintentar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
