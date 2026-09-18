import { ok, withAuth } from "@/lib/api";
import { lotesDe } from "@/lib/lotes";

/** Las importaciones de la empresa de la sesión, más recientes primero. */
export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => ok({ lotes: await lotesDe(orgId) }), { esLectura: true });
}
