import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { almacenPorOmision, aplicarMovimiento } from "@/lib/almacen";

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  unit: z.string().min(1),
  unitCost: z.coerce.number().min(0).default(0),
  quantityOnHand: z.coerce.number().min(0).default(0),
  minQuantity: z.coerce.number().min(0).default(0),
  maxQuantity: z.coerce.number().min(0).default(0),
  bin: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ orgId }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const parts = await prisma.part.findMany({
      where: {
        organizationId: orgId,
        active: true,
        ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { code: "asc" },
      take: 300,
    });
    return ok({ parts });
  });
}

export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ orgId }) => {
    const input = schema.parse(await request.json());

    // Categoria y unidad son catalogos: se validan del lado del servidor, no
    // solo en el formulario. De otro modo bastaria una peticion directa para
    // reintroducir texto libre y volver a ensuciar el inventario.
    const unidad = await prisma.partUnit.findFirst({
      where: { organizationId: orgId, code: input.unit },
      select: { id: true },
    });
    if (!unidad) {
      return fail(`La unidad "${input.unit}" no esta en el catalogo de unidades de medida`, 422);
    }

    if (input.category) {
      const familia = await prisma.partCategory.findFirst({
        where: { organizationId: orgId, code: input.category },
        select: { id: true },
      });
      if (!familia) {
        return fail(`La familia "${input.category}" no esta en el catalogo de familias de refaccion`, 422);
      }
    }
    // Nace en cero y la existencia inicial entra como movimiento: asi el kardex
    // cuadra desde el primer dia y la existencia queda asentada en un almacen
    // concreto, en vez de ser un numero sin origen ni lugar.
    const part = await prisma.part.create({
      data: { ...input, quantityOnHand: 0, organizationId: orgId, supplierId: input.supplierId || null },
    });

    if (input.quantityOnHand > 0) {
      const almacen = await almacenPorOmision(orgId);
      if (!almacen) return fail("La cuenta no tiene ningun almacen activo", 409);
      await aplicarMovimiento({
        organizationId: orgId,
        partId: part.id,
        warehouseId: almacen.id,
        tipo: "IN",
        cantidad: input.quantityOnHand,
        costoUnitario: input.unitCost,
        referencia: "Inventario inicial",
      });
    }

    return ok({ part }, 201);
  });
}
