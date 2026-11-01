import { corridaDeCron } from "@/lib/cron";
import { limpiarMensajes } from "@/lib/consultor/consultor";

export const dynamic = "force-dynamic";

/**
 * Tarea programada: borrar la conversacion del Consultor de mas de 180 dias.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/consultor
 *
 * Una vez al dia sobra: lo que se cuida es que nada pase de 180 dias, no la hora.
 */
export async function GET(request: Request) {
  return corridaDeCron(request, "consultor", async () => ({ borrados: await limpiarMensajes(new Date()) }));
}
