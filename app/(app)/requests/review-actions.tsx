"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { TIPOS_SOLICITUD, esTipoValido, type ClaveTipoSolicitud } from "@/lib/tipos-solicitud";

export function ReviewActions({
  requestId,
  technicians,
  tipoActual,
  tipoSugerido,
}: {
  requestId: string;
  technicians: Array<{ id: string; name: string }>;
  /** Lo que ya se haya clasificado, si alguien la reviso antes. */
  tipoActual?: string | null;
  /** Lo que propuso la IA en el triage, si corrio. */
  tipoSugerido?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const [assignedToId, setAssignedToId] = useState("");
  /**
   * Quien revisa clasifica, no quien reporta.
   *
   * De aqui sale si el trabajo cuenta como falla: un apoyo o una mejora que
   * entren como correctivo inflan el Pareto y hacen creer que los equipos
   * fallan mas de lo que fallan.
   */
  const [tipo, setTipo] = useState<string>(
    tipoActual ?? (esTipoValido(tipoSugerido) ? tipoSugerido : "FALLA"),
  );
  const [notes, setNotes] = useState("");

  async function submit() {
    setLoading(true);
    const res = await fetch(`/api/requests/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: open,
        reviewNotes: notes || undefined,
        assignedToId: assignedToId || null,
        tipo,
      }),
    });
    const data = await res.json();
    setLoading(false);
    setOpen(null);
    if (res.ok && data.workOrder) {
      router.push(`/work-orders/${data.workOrder.id}`);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() => setOpen("APPROVE")}
          title="Aprobar y generar OT"
          className="grid h-7 w-7 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen("REJECT")}
          title="Rechazar"
          className="grid h-7 w-7 place-items-center rounded-lg text-red-500 hover:bg-red-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-left shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {open === "APPROVE" ? "Aprobar y generar orden" : "Rechazar solicitud"}
            </h3>
            <div className="mt-4 grid gap-4">
              {open === "APPROVE" ? (
                <div>
                  <label className="label">De que se trata</label>
                  <select className="field" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    {Object.entries(TIPOS_SOLICITUD).map(([clave, t]) => (
                      <option key={clave} value={clave}>{t.etiqueta}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
                    {TIPOS_SOLICITUD[tipo as ClaveTipoSolicitud]?.descripcion}
                    {tipo === "APOYO" ? (
                      <span className="mt-1 block text-slate-600">
                        Se registran sus horas y su costo, pero no cuenta como falla del equipo.
                      </span>
                    ) : null}
                  </p>
                  {esTipoValido(tipoSugerido) && tipoSugerido !== tipo ? (
                    <button
                      type="button"
                      onClick={() => setTipo(tipoSugerido)}
                      className="mt-1.5 text-[0.6875rem] text-brand-700 underline"
                    >
                      La IA propuso «{TIPOS_SOLICITUD[tipoSugerido].etiqueta}». Usar esa.
                    </button>
                  ) : null}
                </div>
              ) : null}

              {open === "APPROVE" ? (
                <div>
                  <label className="label">Asignar a</label>
                  <select className="field" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="label">Notas de revision</label>
                <textarea className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(null)}>Cancelar</Button>
              <Button variant={open === "APPROVE" ? "success" : "danger"} onClick={submit} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {open === "APPROVE" ? "Aprobar" : "Rechazar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
