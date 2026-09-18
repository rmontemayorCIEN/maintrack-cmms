import { NextResponse } from "next/server";
import { correrAvisos } from "@/lib/avisos/proceso";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tarea programada de avisos: detecta vencimientos y pendientes, escala lo que
 * nadie atiende, manda los resúmenes que tocan y procesa la cola de entregas
 * (correo, navegador, webhooks) con sus reintentos.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/avisos
 *
 * Cada cinco minutos: es la resolución de los recordatorios y de los
 * reintentos. Todo es idempotente, así que correrlo de más no duplica avisos.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const r = await correrAvisos();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...r });
}
