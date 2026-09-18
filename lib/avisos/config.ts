/**
 * La configuración de avisos de una empresa, con sus valores recomendados.
 *
 * Una empresa sin renglón en `ConfigAvisos` recibe exactamente estos valores:
 * no tiene que configurar nada para empezar.
 */
import { prisma } from "../db";
import { ZONA_POR_OMISION } from "../periodos";
import type { Canal } from "./catalogo";
import type { Ventana } from "./horario";
import { reglasDe, type AjusteRegla } from "./reglas";

export const CONFIG_RECOMENDADA = {
  canales: ["NAVEGADOR", "CORREO", "WEBHOOK"] as Canal[],
  horaInicio: "08:00",
  horaFin: "18:00",
  anticipacionHoras: 24,
  destinatariosAdmin: [] as string[],
  resumenDiario: true,
  resumenSemanal: true,
  horaResumen: "07:30",
  resumenSinPendientes: false,
  reglas: {} as Record<string, AjusteRegla>,
  remitente: null as string | null,
};

export type ConfigEmpresa = typeof CONFIG_RECOMENDADA & {
  zona: string;
  diasHabiles: number[];
  festivos: string[];
  avisosPush: boolean;
};

export function leerJson<T>(texto: string | null | undefined, porOmision: T): T {
  try {
    const v = JSON.parse(texto ?? "");
    return (v ?? porOmision) as T;
  } catch {
    return porOmision;
  }
}

/**
 * Lo que rige para la empresa. Los festivos se leen del año en curso y el que
 * sigue: con eso alcanza para programar cualquier recordatorio.
 */
export async function configDe(organizationId: string, ahora = new Date()): Promise<ConfigEmpresa> {
  const desde = new Date(ahora.getTime() - 2 * 86_400_000);
  const hasta = new Date(ahora.getTime() + 400 * 86_400_000);
  const [org, c, festivos] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true, diasHabiles: true, avisosPush: true },
    }),
    prisma.configAvisos.findUnique({ where: { organizationId } }),
    prisma.diaFestivo.findMany({ where: { organizationId, fecha: { gte: desde, lte: hasta } }, select: { fecha: true } }),
  ]);
  return {
    canales: c ? leerJson<Canal[]>(c.canales, CONFIG_RECOMENDADA.canales) : CONFIG_RECOMENDADA.canales,
    horaInicio: c?.horaInicio ?? CONFIG_RECOMENDADA.horaInicio,
    horaFin: c?.horaFin ?? CONFIG_RECOMENDADA.horaFin,
    anticipacionHoras: c?.anticipacionHoras ?? CONFIG_RECOMENDADA.anticipacionHoras,
    destinatariosAdmin: c ? leerJson<string[]>(c.destinatariosAdmin, []) : [],
    resumenDiario: c?.resumenDiario ?? true,
    resumenSemanal: c?.resumenSemanal ?? true,
    horaResumen: c?.horaResumen ?? CONFIG_RECOMENDADA.horaResumen,
    resumenSinPendientes: c?.resumenSinPendientes ?? false,
    reglas: c ? leerJson<Record<string, AjusteRegla>>(c.reglas, {}) : {},
    remitente: c?.remitente ?? null,
    zona: org?.timezone || ZONA_POR_OMISION,
    diasHabiles: (org?.diasHabiles ?? "1,2,3,4,5").split(",").map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7),
    // Los festivos se guardan como la medianoche UTC de su fecha: su clave es la fecha UTC.
    festivos: festivos.map((f) => f.fecha.toISOString().slice(0, 10)),
    avisosPush: org?.avisosPush ?? false,
  };
}

export function ventanaDe(c: ConfigEmpresa, persona?: { horaInicio?: string | null; horaFin?: string | null }): Ventana {
  return {
    zona: c.zona,
    horaInicio: persona?.horaInicio || c.horaInicio,
    horaFin: persona?.horaFin || c.horaFin,
    diasHabiles: c.diasHabiles,
    festivos: c.festivos,
  };
}

export function reglasDeEmpresa(c: ConfigEmpresa) {
  return reglasDe(c.reglas);
}
