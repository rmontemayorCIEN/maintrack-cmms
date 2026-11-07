import { z } from "@/lib/zod";
import { fail, ok, withVista } from "@/lib/api";
import { latitudZod, longitudZod } from "@/lib/geografia";
import { CAPAS, PERIODOS_DIAS } from "@/lib/mapa";
import { CapaNoPermitida, consultarMapa } from "@/lib/mapa-consulta";
import { verCostos } from "@/lib/pantallas";

const consulta = z.object({
  norte: latitudZod, sur: latitudZod, este: longitudZod, oeste: longitudZod,
  siteId: z.string().max(40).optional(),
  categoryId: z.string().max(40).optional(),
  // La rejilla de grupos: la elige el navegador segun el tamano de su mapa, con tope para que no pida millones de celdas.
  columnas: z.coerce.number().int().min(2).max(30).default(10),
  filas: z.coerce.number().int().min(2).max(30).default(8),
  status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "STANDBY", "RETIRED"]).optional(),
  capa: z.enum(CAPAS).default("ESTADO"),
  // Solo los períodos que la pantalla ofrece: un número libre sería una consulta que nadie pidió.
  dias: z.coerce.number().int().refine((d) => (PERIODOS_DIAS as readonly number[]).includes(d), "Período no válido").default(365),
});

/** Los activos con coordenadas dentro de la zona visible del mapa, como puntos o como grupos. */
export async function GET(request: Request) {
  return withVista("/assets", async ({ user, orgId }) => {
    const url = new URL(request.url);
    const crudo = Object.fromEntries([...url.searchParams].filter(([, v]) => v !== ""));
    const { norte, sur, este, oeste, columnas, filas, capa, dias, ...filtros } = consulta.parse(crudo);
    try {
      return ok(await consultarMapa(orgId, { norte, sur, este, oeste }, filtros, { columnas, filas }, {
        capa, dias, puedeVerCostos: verCostos(user.role),
      }));
    } catch (e) {
      if (e instanceof CapaNoPermitida) return fail("Su rol no ve costos", 403);
      throw e;
    }
  });
}
