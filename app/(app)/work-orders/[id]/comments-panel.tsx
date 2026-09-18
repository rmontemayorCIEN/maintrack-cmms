"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { SIN_RED, useBorrador } from "@/lib/cliente/borrador";

/**
 * La bitácora de la orden. Desde campo sirve también para pedir apoyo: la nota
 * queda en la orden y, marcada, avisa a supervisión. Lo escrito no se pierde si
 * falla el envío o se cae la señal: se conserva hasta que llegue.
 */
export function CommentsPanel({
  workOrderId,
  comments,
  editable,
}: {
  workOrderId: string;
  comments: Array<{ id: string; body: string; name: string; color: string; createdAt: string }>;
  editable: boolean;
}) {
  const zona = useZona();
  const router = useRouter();
  const { valor, setValor, limpiar } = useBorrador(`bitacora:${workOrderId}`, { body: "", apoyo: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valor.body.trim() || loading) return;
    setLoading(true);
    setError(null);
    setEnviado(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: valor.body, pedirApoyo: valor.apoyo }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No se guardó la nota. Intente de nuevo.");
        return;
      }
      setEnviado(valor.apoyo ? "Nota guardada y aviso enviado a supervisión." : "Nota guardada.");
      limpiar();
      router.refresh();
    } catch {
      setError(SIN_RED);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      {comments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
          Sin notas registradas
        </p>
      ) : (
        <ul className="grid gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <Avatar name={comment.name} color={comment.color} />
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-slate-700">{comment.name}</p>
                  <p className="text-[0.625rem] text-slate-400">{formatDateTime(comment.createdAt, zona)}</p>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form onSubmit={submit} className="grid gap-2">
          <label htmlFor={`nota-${workOrderId}`} className="sr-only">Nota para la bitácora</label>
          <div className="flex gap-2">
            <textarea
              id={`nota-${workOrderId}`}
              className="field min-h-11"
              rows={1}
              value={valor.body}
              onChange={(e) => setValor((v) => ({ ...v, body: e.target.value }))}
              placeholder={valor.apoyo ? "¿Qué necesita? Ej. otra persona para cargar el motor" : "Agregar una nota a la bitácora…"}
            />
            <Button type="submit" disabled={loading || !valor.body.trim()} className="min-h-11 shrink-0" aria-label="Guardar nota">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={valor.apoyo} onChange={(e) => setValor((v) => ({ ...v, apoyo: e.target.checked }))} />
            Pedir apoyo a supervisión (se le avisa)
          </label>
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          {enviado ? <p role="status" className="text-sm text-emerald-700">{enviado}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
