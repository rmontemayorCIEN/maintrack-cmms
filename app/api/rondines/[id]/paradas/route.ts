import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { agregarParada } from "@/lib/rondin";

/**
 * Anotar una parada.
 *
 * Las tres entradas son opcionales a proposito: se puede llegar con el codigo
 * QR, eligiendo el equipo, dictando, o con nada de eso. Una parada sin equipo
 * se guarda igual —«charco de aceite en el pasillo»— porque lo que se vio no
 * puede perderse porque falte saber de quien era.
 */
const parada = z.object({
  tokenQr: z.string().trim().max(200).optional().nullable(),
  assetIdElegido: z.string().optional().nullable(),
  dicho: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId }) => {
    const input = parada.parse(await request.json().catch(() => ({})));
    const r = await agregarParada(orgId, id, input);
    if (!r.ok) return fail(r.motivo, 409);
    return ok({
      parada: r.parada,
      // La pantalla usa esto para decidir si se detiene a preguntar o sigue.
      hayQuePreguntar: r.hayQuePreguntar,
      candidatos: r.candidatos,
      explicacion: r.explicacion,
    }, 201);
  });
}
