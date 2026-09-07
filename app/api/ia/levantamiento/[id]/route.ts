import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { verificarCupo } from "@/lib/planes";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  siteId: z.string().min(1),
  locationId: z.string().optional().nullable(),
  prefijo: z.string().trim().min(1).max(6).default("ACT"),
  aceptados: z.array(z.string()).min(1).max(400),
});

/**
 * Aplica el borrador: crea los activos aceptados.
 *
 * Se crean con la placa VACIA —fabricante, modelo, serie— y con una nota que
 * dice que salieron de un levantamiento asistido. Asi el recorrido de campo
 * sabe exactamente que le falta verificar, y nadie confunde un dato propuesto
 * con uno confirmado.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const intake = await prisma.assetIntake.findFirst({
      where: { id, organizationId: orgId },
      include: { propuestas: true },
    });
    if (!intake) return fail("Levantamiento no encontrado", 404);

    const input = schema.parse(await request.json());
    const sitio = await prisma.site.findFirst({ where: { id: input.siteId, organizationId: orgId }, select: { id: true } });
    if (!sitio) return fail("Sitio no encontrado", 404);

    const elegidos = intake.propuestas.filter(
      (p) => input.aceptados.includes(p.id) && p.estado !== "APLICADO",
    );
    if (!elegidos.length) return fail("No hay propuestas pendientes en esa selección", 409);

    const total = elegidos.reduce((s, p) => s + p.cantidad, 0);
    const cupo = await verificarCupo(orgId, user.organization.plan, "assets");
    if (!cupo.permitido) return fail(cupo.mensaje, 402);

    /** Compara nombres ignorando mayusculas, acentos y espacios de mas. */
    const normalizar = (t: string) =>
      t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

    // Las categorias que el borrador propuso y no existen se dan de alta: sin
    // ellas los activos nacerian sueltos y el filtrado por familia no serviria.
    //
    // El codigo va corto y en mayusculas (CLIM) y el nombre visible sale del
    // sistema al que pertenece el equipo ("Climatizacion"). Antes los dos
    // campos recibian el mismo valor y el cliente terminaba leyendo "CLIM" en
    // sus reportes.
    const categorias = new Map(
      (await prisma.assetCategory.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } }))
        .map((c) => [c.code.toUpperCase(), c.id]),
    );
    for (const p of elegidos) {
      const code = (p.categoria ?? "OTRO").toUpperCase().slice(0, 20);
      if (!categorias.has(code)) {
        const creada = await prisma.assetCategory.create({
          data: {
            organizationId: orgId,
            code,
            name: p.sistema?.trim() || p.categoria || "Otros",
          },
          select: { id: true },
        });
        categorias.set(code, creada.id);
      }
    }

    // Las ubicaciones que dedujo la IA se resuelven contra las del sitio y se
    // dan de alta las que falten.
    //
    // Antes se aplicaba una sola ubicacion del formulario a todo el lote y la
    // deduccion por activo se descartaba, aunque ya estaba hecha y pagada. El
    // resultado era que los equipos nacian sueltos y el area terminaba metida
    // dentro del nombre, donde no se puede filtrar ni recorrer.
    const ubicaciones = new Map(
      (await prisma.location.findMany({
        where: { organizationId: orgId, siteId: sitio.id },
        select: { id: true, name: true },
      })).map((l) => [normalizar(l.name), l.id]),
    );
    const codigosUsados = new Set(
      (await prisma.location.findMany({
        where: { organizationId: orgId, siteId: sitio.id },
        select: { code: true },
      })).map((l) => l.code.toUpperCase()),
    );
    for (const p of elegidos) {
      const nombre = p.ubicacion?.trim();
      if (!nombre || ubicaciones.has(normalizar(nombre))) continue;
      let code = normalizar(nombre).replace(/[^a-z0-9]/g, "").slice(0, 6).toUpperCase() || "UBIC";
      let n = 1;
      while (codigosUsados.has(code)) code = `${code.slice(0, 5)}${++n}`;
      codigosUsados.add(code);
      const creada = await prisma.location.create({
        data: { organizationId: orgId, siteId: sitio.id, code, name: nombre.slice(0, 80) },
        select: { id: true },
      });
      ubicaciones.set(normalizar(nombre), creada.id);
    }

    const ultimo = await prisma.asset.count({ where: { organizationId: orgId } });
    let consecutivo = ultimo;
    const creados: string[] = [];

    // La ubicacion del formulario queda solo como respaldo: aplica cuando la
    // IA no supo deducir el area de ese equipo en concreto.
    const respaldoUbicacion = input.locationId || null;

    for (const p of elegidos) {
      const codigos: string[] = [];
      const ubicacionId =
        (p.ubicacion ? ubicaciones.get(normalizar(p.ubicacion)) : undefined) ?? respaldoUbicacion;
      for (let i = 0; i < p.cantidad; i++) {
        consecutivo += 1;
        const code = `${input.prefijo.toUpperCase()}-${String(consecutivo).padStart(3, "0")}`;
        await prisma.asset.create({
          data: {
            organizationId: orgId,
            siteId: sitio.id,
            locationId: ubicacionId,
            categoryId: categorias.get((p.categoria ?? "OTRO").toUpperCase().slice(0, 20)) ?? null,
            code,
            name: p.cantidad > 1 ? `${p.nombre} ${i + 1}` : p.nombre,
            criticality: p.criticidad,
            status: "OPERATIONAL",
            description: [
              p.porQue,
              [p.fabricante, p.modelo].filter(Boolean).length
                ? `Placa sugerida sin confirmar: ${[p.fabricante, p.modelo].filter(Boolean).join(" ")}`
                : null,
              `Propuesto en levantamiento asistido (${p.sistema}). Falta verificar en piso: placa, ubicacion exacta y estado.`,
            ].filter(Boolean).join(" · "),
          },
        });
        codigos.push(code);
        creados.push(code);
      }
      await prisma.assetDraft.update({
        where: { id: p.id },
        data: { estado: "APLICADO", codigoCreado: codigos.join(", ") },
      });
    }

    await prisma.assetIntake.update({
      where: { id },
      data: { estado: "APLICADO", aplicadoEl: new Date() },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "AssetIntake", entityId: id, action: "APPLIED",
      summary: `Alta de ${creados.length} activos desde levantamiento asistido`,
    });

    return ok({ creados: creados.length, codigos: creados.slice(0, 20), totalEsperado: total }, 201);
  });
}

/** Descarta propuestas sin borrar el levantamiento. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ orgId }) => {
    const intake = await prisma.assetIntake.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    if (!intake) return fail("Levantamiento no encontrado", 404);
    const { descartados } = z.object({ descartados: z.array(z.string()).max(400) }).parse(await request.json());
    await prisma.assetDraft.updateMany({
      where: { id: { in: descartados }, intakeId: id },
      data: { estado: "DESCARTADO" },
    });
    return ok({ descartados: descartados.length });
  });
}
