import { z } from "zod";
import { ok, withVista } from "@/lib/api";
import { latitudZod, longitudZod } from "@/lib/geografia";
import { consultarMapa } from "@/lib/mapa-consulta";

const consulta = z.object({
  norte: latitudZod, sur: latitudZod, este: longitudZod, oeste: longitudZod,
  siteId: z.string().max(40).optional(),
  categoryId: z.string().max(40).optional(),
  // La rejilla de grupos: la elige el navegador segun el tamano de su mapa, con tope para que no pida millones de celdas.
  columnas: z.coerce.number().int().min(2).max(30).default(10),
  filas: z.coerce.number().int().min(2).max(30).default(8),
  status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"]).optional(),
});

/** Los activos con coordenadas dentro de la zona visible del mapa, como puntos o como grupos. */
export async function GET(request: Request) {
  return withVista("/assets", async ({ orgId }) => {
    const url = new URL(request.url);
    const crudo = Object.fromEntries([...url.searchParams].filter(([, v]) => v !== ""));
    const { norte, sur, este, oeste, columnas, filas, ...filtros } = consulta.parse(crudo);
    return ok(await consultarMapa(orgId, { norte, sur, este, oeste }, filtros, { columnas, filas }));
  });
}
