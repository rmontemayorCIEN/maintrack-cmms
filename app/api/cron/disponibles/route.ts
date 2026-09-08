import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { avisarTrabajoDisponible } from "@/lib/aviso-ya-se-puede";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tarea programada: avisar el trabajo que YA SE PUEDE hacer.
 *
 * Recorre las organizaciones activas y le dice a la gente que la refaccion que
 * trababa una actividad ya llego. Es el aviso mas valioso del sistema porque
 * es el unico que recorta una espera de dias; los demas informan de algo que
 * ya paso.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/disponibles
 *
 * Cada media hora es de sobra: se esta recortando una espera que hoy tiene una
 * mediana de diez dias. Correrlo cada minuto no ganaria nada y multiplicaria
 * las consultas.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const organizaciones = await prisma.organization.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true },
  });

  const resumen = [];
  for (const org of organizaciones) {
    try {
      const r = await avisarTrabajoDisponible(org.id);
      // Solo se reportan las que movieron algo: un listado de treinta ceros
      // esconde la unica linea que importaba.
      if (r.avisadas || r.revertidas) resumen.push({ organizacion: org.name, ...r });
    } catch (error) {
      // Una organizacion con un dato raro no puede dejar sin aviso a las demas.
      console.error("[cron/disponibles]", org.name, error instanceof Error ? error.message : error);
      resumen.push({ organizacion: org.name, error: true });
    }
  }

  return NextResponse.json({
    corrioA: new Date().toISOString(),
    organizaciones: organizaciones.length,
    conCambios: resumen,
  });
}
