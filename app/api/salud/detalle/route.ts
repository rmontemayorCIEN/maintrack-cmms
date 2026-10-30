import { responderSalud } from "@/lib/salud/maintrack";

export const dynamic = "force-dynamic";

/**
 * El reporte de salud para la Torre de Control: una revision por cosa que
 * puede fallar (base, procesos, avisos, IA, secretos), solo conteos.
 *
 * Pide `Authorization: Bearer <TORRE_SALUD_TOKEN>`. Sin token configurado, o
 * con uno equivocado, contesta 404. El contrato vive en lib/salud/contrato.ts
 * (copia del de la Torre) y las revisiones en lib/salud/maintrack.ts.
 *
 * El middleware no la toca: su `matcher` excluye todo `/api`.
 */
export async function GET(req: Request) {
  return responderSalud(req);
}
