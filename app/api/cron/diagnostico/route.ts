import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generarDiagnostico } from "@/lib/ia/diagnostico";
import { iaConfigurada, sanear } from "@/lib/ia/cliente";
import { avisarDeFallas, fallasRecientes } from "@/lib/ia/fallas";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Diagnostico semanal de todas las organizaciones con IA en su plan.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://APP/api/cron/diagnostico
 *
 * Se ejecuta una vez por semana. Cada organizacion se procesa por separado y un
 * error en una no detiene a las demas: es dinero ya gastado en las anteriores y
 * no tendria por que perderse el resto.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Sin llave configurada no hay nada que hacer, y eso no es una falla de la
  // tarea programada: se responde 200 con el motivo para no encender alarmas.
  if (!iaConfigurada()) {
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      omitido: "ANTHROPIC_API_KEY no esta configurada en este servicio",
      organizaciones: [],
    });
  }

  const organizaciones = await prisma.organization.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true },
  });

  const resumen: Array<{ empresa: string; estado: string; costoUsd?: number }> = [];
  let costoTotal = 0;
  // Solo lo que falle en ESTA corrida amerita aviso.
  const inicio = new Date();

  for (const org of organizaciones) {
    try {
      const r = await generarDiagnostico(org, { origen: "AUTOMATICO" });
      if (r.ok) {
        costoTotal += r.reporte.costoUsd;
        resumen.push({ empresa: org.name, estado: "generado", costoUsd: r.reporte.costoUsd });
      } else {
        resumen.push({ empresa: org.name, estado: `omitida: ${r.motivo}` });
      }
    } catch (error) {
      const mensaje = sanear(error instanceof Error ? error.message : "error desconocido");
      console.error(`Diagnostico de ${org.name}: ${mensaje}`);
      resumen.push({ empresa: org.name, estado: `error: ${mensaje}` });
    }
  }

  // Si algo dejo al servicio sin poder llamar al modelo —llave, saldo,
  // configuracion— el operador se entera hoy y no cuando reclame un cliente.
  const fallas = await fallasRecientes(inicio);
  const avisos = await avisarDeFallas(fallas);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    costoTotalUsd: Math.round(costoTotal * 10000) / 10000,
    organizaciones: resumen,
    avisosEnviados: avisos,
  });
}
