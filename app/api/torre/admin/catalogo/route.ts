import { CATALOGO, conTorre, responder } from "@/lib/torre/cuentas";

/** Administracion desde la Torre de Control: que ofrece MainTrack. Sin firma valida, 404. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return conTorre(request, async () => responder(CATALOGO));
}
