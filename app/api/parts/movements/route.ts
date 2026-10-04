import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen, almacenPorOmision, aplicarMovimiento } from "@/lib/almacen";
import { motivoValido, motivosDe, nombreDeMotivo, pideNota, TIPOS_CON_MOTIVO } from "@/lib/motivos-movimiento";

const schema = z.object({
  partId: z.string(),
  warehouseId: z.string().optional().nullable(),
  movementType: z.enum(["IN", "OUT", "ADJUST", "RETURN"]),
  quantity: z.coerce.number(),
  unitCost: z.coerce.number().min(0).optional(),
  reference: z.string().optional(),
  motivo: z.string().optional().nullable(),
});

/** Lo minimo para que un motivo sirva de algo dentro de seis meses. */
const MOTIVO_MINIMO = 4;

/**
 * Entradas, salidas, ajustes y devoluciones de almacen.
 *
 * El calculo del saldo, el costo promedio y el kardex viven en lib/almacen.ts:
 * esta ruta solo valida lo que llega y decide a que almacen aplica cuando el
 * usuario no lo indico.
 *
 * ── Una entrada tiene que decir de donde viene ──
 *
 * Medido en produccion: las salidas, los traspasos y las devoluciones llevan
 * su documento —la orden, el traspaso, la requisicion— el 100% de las veces.
 * Las entradas, solo el 15%. Y entre las que no lo llevan aparecieron cinco
 * con el texto «Compra de reposicion»: material que SI venia de una compra y
 * entro suelto, sin quedar ligado a ella.
 *
 * Eso tiene consecuencias que no se ven el dia que pasa. El kardex dice
 * «compra de reposicion» y no se puede volver a la orden de compra —que es
 * justo lo que `goodsReceiptId` vino a evitar—. El costo promedio ponderado se
 * mueve con un costo capturado a mano y sin respaldo, y ese numero termina en
 * el costo de cada orden de trabajo. Y no hay forma de auditar si esas tres
 * bandas llegaron de la OC-123 o las metio alguien.
 *
 * Por eso una entrada manual exige motivo. Lo que viene de una compra NO se
 * captura aqui: se recibe en la compra, que ademas escribe el folio de
 * recepcion, mueve el estado y avisa a quien la pidio. Un segundo camino para
 * recibir seria un segundo camino que se desincroniza.
 *
 * Salida y ajuste se quedan como estaban: ya llevan su documento.
 */
export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    // El motivo se exige aqui, no solo en la pantalla: por la ruta entran
    // tambien la API publica y las integraciones.
    const nota = (input.reference ?? "").trim();
    if (TIPOS_CON_MOTIVO.includes(input.movementType)) {
      if (!motivoValido(input.movementType, input.motivo)) {
        const cuales = motivosDe(input.movementType).map((m) => m.nombre).join(", ");
        return fail(
          input.movementType === "IN"
            ? `Diga de dónde viene la entrada. Si el material llegó de una compra, recíbalo en la compra para que quede ligado a ella; si no, elija el motivo: ${cuales}.`
            : `Diga por qué se ajusta: ${cuales}.`,
          422,
        );
      }
      // Hay motivos que no se explican solos: «otro», una compra sin orden, un
      // prestamo de otra planta, algo que se perdio. En esos la nota es el dato.
      if (pideNota(input.motivo) && nota.length < MOTIVO_MINIMO) {
        return fail(`Con «${nombreDeMotivo(input.motivo)}» hace falta explicar brevemente qué pasó.`, 422);
      }
    }

    const warehouseId = input.warehouseId || (await almacenPorOmision(orgId))?.id;
    if (!warehouseId) return fail("La cuenta no tiene ningún almacén activo", 409);

    try {
      const balance = await aplicarMovimiento({
        organizationId: orgId,
        partId: input.partId,
        warehouseId,
        tipo: input.movementType,
        cantidad: input.quantity,
        costoUnitario: input.unitCost,
        referencia: input.reference,
        motivo: input.motivo ?? null,
        userId: user.id,
      });
      return ok({ balance }, 201);
    } catch (error) {
      if (error instanceof ErrorDeAlmacen) return fail(error.message, 422);
      throw error;
    }
  });
}
