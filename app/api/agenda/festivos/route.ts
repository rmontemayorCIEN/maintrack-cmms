import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { festivosDeLey } from "@/lib/agenda";
import { logAudit } from "@/lib/audit";

/** Un dia que la empresa no trabaja. */
const crear = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use el formato AAAA-MM-DD"),
  nombre: z.string().trim().min(2).max(80),
});

/** Fecha local a mediodia: evita que el cambio de zona la corra un dia. */
const aFecha = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};

export async function POST(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const cuerpo = await request.json();

    // Sembrar los de ley de un anio completo.
    if (cuerpo?.sembrarAnio) {
      const anio = z.coerce.number().int().min(2020).max(2100).parse(cuerpo.sembrarAnio);
      let creados = 0;
      for (const f of festivosDeLey(anio)) {
        const ya = await prisma.diaFestivo.findUnique({
          where: { organizationId_fecha: { organizationId: orgId, fecha: f.fecha } },
          select: { id: true },
        });
        if (ya) continue;
        await prisma.diaFestivo.create({
          data: { organizationId: orgId, fecha: f.fecha, nombre: f.nombre, deLey: true, createdById: user.id },
        });
        creados++;
      }
      return ok({ creados });
    }

    const datos = crear.parse(cuerpo);
    const fecha = aFecha(datos.fecha);
    const ya = await prisma.diaFestivo.findUnique({
      where: { organizationId_fecha: { organizationId: orgId, fecha } },
      select: { id: true, nombre: true },
    });
    if (ya) return fail(`Ese dia ya esta registrado como «${ya.nombre}»`, 409);

    const festivo = await prisma.diaFestivo.create({
      data: { organizationId: orgId, fecha, nombre: datos.nombre, createdById: user.id },
    });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "DiaFestivo", entityId: festivo.id, action: "CREATED",
      summary: `Dia no laborable: ${datos.fecha} — ${datos.nombre}`,
    });
    return ok({ festivo }, 201);
  });
}

export async function DELETE(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    const festivo = await prisma.diaFestivo.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, nombre: true, fecha: true },
    });
    if (!festivo) return fail("Dia no encontrado", 404);

    await prisma.diaFestivo.delete({ where: { id: festivo.id } });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "DiaFestivo", entityId: festivo.id, action: "DELETED",
      summary: `Dia no laborable quitado: ${festivo.fecha.toISOString().slice(0, 10)} — ${festivo.nombre}`,
    });
    return ok({ success: true });
  });
}
