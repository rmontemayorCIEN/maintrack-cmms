"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

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
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    await fetch(`/api/work-orders/${workOrderId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setLoading(false);
    setBody("");
    router.refresh();
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
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form onSubmit={submit} className="flex gap-2">
          <input
            className="field"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Agregar una nota a la bitácora…"
          />
          <Button type="submit" size="sm" disabled={loading || !body.trim()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
