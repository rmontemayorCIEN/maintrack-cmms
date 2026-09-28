import { fail, ok, withAuth } from "@/lib/api";
import { devolver } from "@/lib/herramientas";

/** La herramienta volvió al almacén. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ orgId, user }) => {
    const cuerpo = (await req.json().catch(() => null)) as
      | { estadoRegreso?: string; nota?: string }
      | null;

    const r = await devolver({
      organizationId: orgId,
      resguardoId: id,
      recibidoPorId: user.id,
      estadoRegreso: cuerpo?.estadoRegreso,
      nota: cuerpo?.nota,
    });
    return r.ok ? ok({ devuelto: true, regresoPeor: r.dato.regresoPeor }) : fail(r.motivo, r.codigo ?? 409);
  });
}
