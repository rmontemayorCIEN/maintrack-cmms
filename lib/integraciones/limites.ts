/**
 * Límites de uso por ventana de tiempo.
 *
 * Una clave dice qué se limita —`api:cred:<id>`, `api:org:<id>`,
 * `api:ruta:<id>:lecturas`, `correo:<org>`, `webhook:<id>`— y la ventana es
 * fija (el minuto o la hora en curso). Vive en la base, no en memoria: Cloud
 * Run corre varias instancias y cada una tendría su propio contador.
 *
 * Cada empresa y cada credencial tienen su propia clave, así que el abuso de
 * una no le quita cupo a otra.
 */
import { prisma } from "../db";

export type Cupo = { permitido: boolean; usados: number; limite: number; reintentarEl: Date; segundos: number };

export async function consumirLimite(clave: string, limite: number, ventanaSeg: number, ahora = new Date()): Promise<Cupo> {
  const inicio = new Date(Math.floor(ahora.getTime() / (ventanaSeg * 1000)) * ventanaSeg * 1000);
  const fin = new Date(inicio.getTime() + ventanaSeg * 1000);
  const r = await prisma.limiteUso.upsert({
    where: { clave_ventana: { clave, ventana: inicio } },
    create: { clave, ventana: inicio, conteo: 1 },
    update: { conteo: { increment: 1 } },
    select: { conteo: true },
  });
  return {
    permitido: r.conteo <= limite, usados: r.conteo, limite, reintentarEl: fin,
    segundos: Math.max(1, Math.ceil((fin.getTime() - ahora.getTime()) / 1000)),
  };
}

/** Borra contadores de ventanas viejas. Lo llama el proceso programado. */
export async function limpiarLimites(ahora = new Date()) {
  await prisma.limiteUso.deleteMany({ where: { ventana: { lt: new Date(ahora.getTime() - 2 * 86_400_000) } } });
}
