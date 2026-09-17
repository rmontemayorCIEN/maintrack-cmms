"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, LogIn, Loader2, Plus, X } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { CLAVES_INSTALACION, INSTALACIONES } from "@/lib/instalaciones";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ORDEN_PLANES } from "@/lib/planes";

type Org = {
  id: string; name: string; slug: string; plan: string; status: string;
  industry: string | null; tipoInstalacion: string | null; trialEndsAt: string | null; createdAt: string;
  iaComplemento: boolean;
  /// Consumo de IA del mes en curso: operaciones y costo real en dolares.
  ia: { operaciones: number; incluidas: number; costoUsd: number } | null;
  /// Avance de puesta en marcha: predice que cuentas se van a caer.
  avance: { porcentaje: number; completa: boolean; siguiente: string | null };
  _count: { users: number; assets: number; workOrders: number };
};

const ESTADO: Record<string, { texto: string; tono: "success" | "info" | "warning" | "danger" | "muted" }> = {
  ACTIVE: { texto: "Activa", tono: "success" },
  TRIAL: { texto: "En prueba", tono: "info" },
  SUSPENDED: { texto: "Suspendida", tono: "danger" },
  CANCELLED: { texto: "Cancelada", tono: "muted" },
};

// El orden vive en lib/planes.ts: aqui se consume, no se vuelve a escribir.
const PLANES = ORDEN_PLANES;

type SolicitudPlan = {
  id: string; empresa: string; planActual: string; planSolicitado: string;
  nota: string | null; pedidoPor: string | null; createdAt: string;
};

export function PanelClientes({
  organizaciones,
  solicitudes,
  organizacionPropiaId,
}: {
  organizaciones: Org[];
  solicitudes: SolicitudPlan[];
  organizacionPropiaId: string;
}) {
  const zona = useZona();
  const router = useRouter();
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", industry: "", tipoInstalacion: "PLANTA", plan: "PROFESSIONAL", trialDays: "30",
    ownerName: "", ownerEmail: "", ownerPassword: "",
  });

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function crear(event: React.FormEvent) {
    event.preventDefault();
    setOcupado("crear");
    setError(null);
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, trialDays: Number(form.trialDays) }),
    });
    const data = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(data.error ?? "No fue posible crear la empresa"); return; }
    setAviso(`Empresa "${data.organization.name}" creada. Ya puede entregar el acceso a su responsable.`);
    setForm({ name: "", industry: "", tipoInstalacion: "PLANTA", plan: "PROFESSIONAL", trialDays: "30", ownerName: "", ownerEmail: "", ownerPassword: "" });
    setCreando(false);
    router.refresh();
  }

  async function entrar(org: Org) {
    setOcupado(org.id);
    const res = await fetch("/api/admin/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: org.id }),
    });
    setOcupado(null);
    if (!res.ok) { setError("No fue posible entrar a esa empresa"); return; }
    router.push("/dashboard");
    router.refresh();
  }

  async function cambiar(org: Org, campo: "plan" | "status" | "iaComplemento" | "tipoInstalacion", valor: string | boolean) {
    setOcupado(org.id);
    setError(null);
    const res = await fetch(`/api/admin/organizations/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
    const data = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(data.error ?? "No fue posible actualizar"); return; }
    router.refresh();
  }

  async function resolver(s: SolicitudPlan, accion: "APLICAR" | "DESCARTAR") {
    setOcupado(s.id);
    setError(null);
    const res = await fetch(`/api/plan-requests/${s.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    const data = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(data.error ?? "No fue posible resolver la solicitud"); return; }
    setAviso(accion === "APLICAR"
      ? `Plan de ${s.empresa} cambiado a ${s.planSolicitado}.`
      : `Solicitud de ${s.empresa} descartada.`);
    setTimeout(() => setAviso(null), 4000);
    router.refresh();
  }

  return (
    <>
      {solicitudes.length ? (
        <Card className="mb-4 border-amber-300 bg-amber-50/60">
          <h3 className="text-sm font-semibold text-amber-950">
            {solicitudes.length === 1
              ? "Una solicitud de cambio de plan"
              : `${solicitudes.length} solicitudes de cambio de plan`}
          </h3>
          <p className="mt-0.5 text-xs text-amber-900/80">
            Al aplicar, el plan cambia de inmediato y la cuenta pasa a activa. Confirme antes que el
            cobro este acordado.
          </p>
          <ul className="mt-3 grid gap-2">
            {solicitudes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                    {s.empresa}
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-500">
                      {s.planActual} <ArrowRight className="h-3 w-3" /> <strong className="text-slate-800">{s.planSolicitado}</strong>
                    </span>
                  </p>
                  <p className="text-[0.6875rem] text-slate-500">
                    {s.pedidoPor ? `Pedido por ${s.pedidoPor} · ` : ""}{formatDateTime(s.createdAt, zona)}
                    {s.nota ? ` · "${s.nota}"` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="success" disabled={ocupado === s.id} onClick={() => resolver(s, "APLICAR")}>
                    {ocupado === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Aplicar
                  </Button>
                  <Button size="sm" variant="secondary" disabled={ocupado === s.id} onClick={() => resolver(s, "DESCARTAR")}>
                    Descartar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Al dar de alta una empresa se crean también sus catálogos base y el usuario responsable.
        </p>
        {!creando ? (
          <Button size="sm" onClick={() => { setCreando(true); setError(null); }}>
            <Plus className="h-3.5 w-3.5" /> Nueva empresa
          </Button>
        ) : null}
      </div>

      {aviso ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {creando ? (
        <Card className="mb-4">
          <form onSubmit={crear}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Nueva empresa cliente</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  El responsable entrara con el correo y la contraseña que defina aquí, y podra cambiarlos después desde Configuración.
                </p>
              </div>
              <button type="button" onClick={() => setCreando(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">Empresa</p>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="label">Razon social o nombre</label>
                <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={2} />
              </div>
              <div>
                <label className="label">Giro</label>
                <input className="field" value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Manufactura, alimentos…" />
              </div>
              <div>
                <label className="label">Tipo de instalación</label>
                <select className="field" value={form.tipoInstalacion} onChange={(e) => set("tipoInstalacion", e.target.value)}>
                  {CLAVES_INSTALACION.map((c) => (
                    <option key={c} value={c}>{INSTALACIONES[c].nombre}</option>
                  ))}
                </select>
                <p className="mt-1 text-[0.6875rem] text-slate-500">
                  Define los ejemplos de captura y le da contexto a la IA. Se puede cambiar después.
                </p>
              </div>
              <div>
                <label className="label">Plan</label>
                <select className="field" value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                  {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Días de prueba</label>
                <input type="number" min="0" max="365" className="field" value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} />
                <p className="mt-1 text-[0.6875rem] text-slate-500">0 = activa de inmediato</p>
              </div>
            </div>

            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">Responsable</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Nombre</label>
                <input className="field" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} required minLength={2} />
              </div>
              <div>
                <label className="label">Correo de acceso</label>
                <input type="email" className="field" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} required />
              </div>
              <div>
                <label className="label">Contraseña inicial</label>
                <input type="text" className="field" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} required minLength={8} placeholder="minimo 8 caracteres" />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="submit" size="sm" disabled={ocupado === "crear"}>
                {ocupado === "crear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Crear empresa
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreando(false)}>Cancelar</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {organizaciones.length === 0 ? (
        <EmptyState title="Sin empresas" description="Aun no hay empresas dadas de alta." />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Puesta en marcha</th>
                  <th>IA</th>
                  <th className="text-right">Usuarios</th>
                  <th className="text-right">Activos</th>
                  <th className="text-right">OT</th>
                  <th>Alta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {organizaciones.map((org) => {
                  const propia = org.id === organizacionPropiaId;
                  const e = ESTADO[org.status] ?? ESTADO.CANCELLED;
                  return (
                    <tr key={org.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{org.name}</p>
                            <p className="truncate text-xs text-slate-500">
                              {org.industry ?? org.slug}
                              {propia ? " · su organización" : ""}
                            </p>
                            <select
                              className="mt-1 w-full max-w-44 rounded-md border border-slate-200 px-1.5 py-0.5 text-[0.6875rem] text-slate-600"
                              value={org.tipoInstalacion ?? "OTRO"}
                              disabled={ocupado === org.id}
                              onChange={(e2) => cambiar(org, "tipoInstalacion", e2.target.value)}
                              title="Tipo de instalacion: alimenta los ejemplos y el contexto de la IA"
                            >
                              {CLAVES_INSTALACION.map((c) => (
                                <option key={c} value={c}>{INSTALACIONES[c].nombre}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          className="field max-w-36 px-1.5 py-1 text-[0.6875rem]"
                          value={org.plan}
                          disabled={propia || ocupado === org.id}
                          onChange={(e2) => cambiar(org, "plan", e2.target.value)}
                        >
                          {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={e.tono}>{e.texto}</Badge>
                          {org.status === "TRIAL" && org.trialEndsAt ? (
                            <span className="text-[0.625rem] text-slate-400">hasta {formatDate(org.trialEndsAt, zona)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5" title={org.avance.siguiente ? `Sigue: ${org.avance.siguiente}` : "Completa"}>
                          <span className={`text-xs font-medium tabular-nums ${
                            org.avance.completa ? "text-emerald-600"
                              : org.avance.porcentaje >= 50 ? "text-amber-600"
                              : "text-red-600"
                          }`}>
                            {org.avance.porcentaje}%
                          </span>
                          {org.avance.siguiente ? (
                            <span className="truncate text-[0.625rem] text-slate-400">{org.avance.siguiente}</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {/* El complemento se activa aqui, al cobrarlo: es la
                            misma pantalla donde se administra el plan. */}
                        <label className="flex cursor-pointer items-center gap-1.5" title="Complemento IA Avanzada">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-slate-300"
                            checked={org.iaComplemento}
                            disabled={ocupado === org.id}
                            onChange={(e2) => cambiar(org, "iaComplemento", e2.target.checked)}
                          />
                          <span className="text-[0.6875rem] text-slate-500">
                            {org.ia && org.ia.incluidas > 0
                              ? `${org.ia.operaciones}/${org.ia.incluidas}`
                              : org.iaComplemento ? "activo" : "—"}
                          </span>
                        </label>
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{org._count.users}</td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{org._count.assets}</td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{org._count.workOrders}</td>
                      <td className="text-xs text-slate-500">{formatDate(org.createdAt, zona)}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {!propia ? (
                            <>
                              <button
                                type="button"
                                onClick={() => entrar(org)}
                                disabled={ocupado === org.id || org.status === "SUSPENDED"}
                                title={org.status === "SUSPENDED" ? "Empresa suspendida" : "Entrar a esta empresa"}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                              >
                                {ocupado === org.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                                Entrar
                              </button>
                              <button
                                type="button"
                                onClick={() => cambiar(org, "status", org.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED")}
                                disabled={ocupado === org.id}
                                className="rounded-lg border border-slate-200 px-2 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
                              >
                                {org.status === "SUSPENDED" ? "Reactivar" : "Suspender"}
                              </button>
                            </>
                          ) : (
                            <span className="text-[0.6875rem] text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
