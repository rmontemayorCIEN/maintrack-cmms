import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { configDe } from "@/lib/avisos/config";
import { REGLAS_RECOMENDADAS, reglasDe } from "@/lib/avisos/reglas";
import { proveedorDeCorreo } from "@/lib/avisos/canales";
import { pushConfigurado } from "@/lib/push";

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const ajuste = z.object({
  esperaMin: z.number().int().min(5).max(10_080).optional(),
  soloJornada: z.boolean().optional(),
  maxRecordatorios: z.number().int().min(0).max(10).optional(),
  activa: z.boolean().optional(),
});
const schema = z.object({
  canales: z.array(z.enum(["NAVEGADOR", "CORREO", "WEBHOOK"])).optional(),
  horaInicio: hora.optional(),
  horaFin: hora.optional(),
  anticipacionHoras: z.number().int().min(1).max(336).optional(),
  destinatariosAdmin: z.array(z.string()).max(50).optional(),
  resumenDiario: z.boolean().optional(),
  resumenSemanal: z.boolean().optional(),
  horaResumen: hora.optional(),
  resumenSinPendientes: z.boolean().optional(),
  reglas: z.record(z.string(), ajuste).optional(),
  remitente: z.string().trim().max(80).nullable().optional(),
});

/** La configuración de avisos de la empresa, con lo que rige hoy y su estado técnico. */
export async function GET() {
  return withAuth("settings:write", async ({ orgId }) => {
    const cfg = await configDe(orgId);
    const personas = await prisma.user.findMany({
      where: { organizationId: orgId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR"] } },
      select: { id: true, name: true, role: true }, orderBy: { name: "asc" },
    });
    return ok({
      ...cfg,
      reglasVigentes: reglasDe(cfg.reglas),
      recomendadas: REGLAS_RECOMENDADAS,
      disponibles: { correo: Boolean(proveedorDeCorreo()), navegador: pushConfigurado() && cfg.avisosPush },
      personas,
    });
  }, { esLectura: true });
}

export async function PUT(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const antes = await configDe(orgId);
    // Destinatarios administrativos: solo personas activas de la empresa.
    let destinatarios: string[] | undefined;
    if (input.destinatariosAdmin) {
      destinatarios = (await prisma.user.findMany({ where: { organizationId: orgId, active: true, id: { in: input.destinatariosAdmin } }, select: { id: true } })).map((u) => u.id);
    }
    const reglas = input.reglas
      ? Object.fromEntries(Object.entries(input.reglas).filter(([k]) => k in REGLAS_RECOMENDADAS))
      : undefined;
    const datos = {
      ...(input.canales ? { canales: JSON.stringify(input.canales) } : {}),
      ...(input.horaInicio ? { horaInicio: input.horaInicio } : {}),
      ...(input.horaFin ? { horaFin: input.horaFin } : {}),
      ...(input.anticipacionHoras ? { anticipacionHoras: input.anticipacionHoras } : {}),
      ...(destinatarios ? { destinatariosAdmin: JSON.stringify(destinatarios) } : {}),
      ...(input.resumenDiario !== undefined ? { resumenDiario: input.resumenDiario } : {}),
      ...(input.resumenSemanal !== undefined ? { resumenSemanal: input.resumenSemanal } : {}),
      ...(input.horaResumen ? { horaResumen: input.horaResumen } : {}),
      ...(input.resumenSinPendientes !== undefined ? { resumenSinPendientes: input.resumenSinPendientes } : {}),
      ...(reglas ? { reglas: JSON.stringify({ ...antes.reglas, ...reglas }) } : {}),
      ...(input.remitente !== undefined ? { remitente: input.remitente || null } : {}),
    };
    await prisma.configAvisos.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...datos }, update: datos });

    // Un registro por clase de cambio: la bitácora se filtra por acción.
    const auditar = (action: string, summary: string, changes: unknown) =>
      logAudit({ organizationId: orgId, userId: user.id, entity: "ConfigAvisos", entityId: orgId, action, summary, changes });
    if (input.canales) await auditar("NOTIFY_CHANNELS_CHANGED", `Canales de avisos: ${input.canales.join(", ") || "ninguno externo"}`, { antes: antes.canales, despues: input.canales });
    if (reglas) await auditar("ESCALATION_RULES_CHANGED", `Reglas de escalamiento ajustadas: ${Object.keys(reglas).join(", ")}`, reglas);
    if (destinatarios) await auditar("ADMIN_RECIPIENTS_CHANGED", `Destinatarios administrativos: ${destinatarios.length || "dueño y administradores"}`, { antes: antes.destinatariosAdmin, despues: destinatarios });
    if (input.resumenDiario !== undefined || input.resumenSemanal !== undefined || input.horaResumen || input.resumenSinPendientes !== undefined) {
      await auditar("SUMMARY_CONFIG_CHANGED", "Configuración de resúmenes", { resumenDiario: input.resumenDiario, resumenSemanal: input.resumenSemanal, horaResumen: input.horaResumen, sinPendientes: input.resumenSinPendientes });
    }
    if (input.horaInicio || input.horaFin || input.anticipacionHoras || input.remitente !== undefined) {
      await auditar("NOTIFY_CONFIG_CHANGED", "Horario, anticipación o remitente de avisos", { horaInicio: input.horaInicio, horaFin: input.horaFin, anticipacionHoras: input.anticipacionHoras, remitente: input.remitente });
    }
    return ok({ ok: true });
  });
}
