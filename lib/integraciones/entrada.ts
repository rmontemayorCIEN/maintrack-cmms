/**
 * Lo que un sistema externo puede meter a MainTrack: solicitudes, lecturas de
 * medidor y condiciones de sensores. Lo usan la API (`/api/v1/*`) y el webhook
 * entrante (`/api/v1/eventos`): una sola validación para las dos puertas.
 *
 * Reglas de todo dato externo:
 *
 *  - La empresa sale de la credencial. Activo, medidor y sensor se buscan
 *    DENTRO de esa empresa; uno de otra empresa responde «no encontrado», igual
 *    que uno que no existe.
 *  - Una lectura pasa por `registrarLectura`, la misma validación que la
 *    captura en pantalla: ni negativa, ni menor que la anterior, ni imposible
 *    para el tipo de medidor. Lo atípico no se acepta por la API (no hay quién
 *    lo justifique): se rechaza y se avisa a supervisión.
 *  - Fecha con zona obligatoria (ISO 8601), no futura, y no más vieja de un año.
 *  - Una lectura repetida (mismo medidor, mismo instante, mismo valor) no se
 *    duplica: se responde con la que ya existe.
 *  - Nada externo toca una orden o un plan directamente: las reglas del
 *    sistema deciden (el plan por uso se adelanta, la alerta predictiva se abre).
 */
import { z } from "zod";
import { prisma } from "../db";
import { nextRequestNumber } from "../numbering";
import { LecturaRechazada, registrarLectura } from "../medidores";
import { ingestSensorReading } from "../predictive";
import { ErrorApi, type RespuestaApi } from "./api";
import type { Identidad } from "./credenciales";
import { avisarSolicitudNueva } from "../avisos/detectores";
import { emitirAviso } from "../avisos/emitir";

const fechaExterna = z.string().datetime({ offset: true, message: "Use ISO 8601 con zona, por ejemplo 2026-09-18T08:30:00-06:00" });

function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new ErrorApi(422, "DATOS_INVALIDOS", "Revise los campos marcados.",
      r.error.issues.map((i) => ({ campo: i.path.join("."), problema: i.message })));
  }
  return r.data;
}

function fechaValida(texto: string | undefined, ahora = new Date()): Date {
  if (!texto) return ahora;
  const f = new Date(texto);
  if (f.getTime() > ahora.getTime() + 5 * 60_000) throw new ErrorApi(422, "FECHA_FUTURA", "La fecha de la lectura está en el futuro.");
  if (f.getTime() < ahora.getTime() - 366 * 86_400_000) throw new ErrorApi(422, "FECHA_ANTIGUA", "La fecha tiene más de un año; cárguela con una importación.");
  return f;
}

// ───────────────────────────────────────────── Solicitudes

export const esquemaSolicitud = z.object({
  titulo: z.string().trim().min(3).max(160),
  descripcion: z.string().trim().max(4000).optional(),
  activo: z.string().trim().max(60).optional().describe("Código del activo"),
  ubicacion: z.string().trim().max(60).optional().describe("Código de la ubicación"),
  prioridad: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

export async function crearSolicitudExterna(quien: Identidad, cuerpo: unknown): Promise<RespuestaApi> {
  const d = validar(esquemaSolicitud, cuerpo);
  const org = quien.organizationId;
  const activo = d.activo
    ? await prisma.asset.findFirst({ where: { organizationId: org, code: d.activo }, select: { id: true, siteId: true, locationId: true } })
    : null;
  if (d.activo && !activo) throw new ErrorApi(404, "ACTIVO_NO_ENCONTRADO", `No existe el activo «${d.activo}».`);
  const ubic = d.ubicacion
    ? await prisma.location.findFirst({ where: { organizationId: org, code: d.ubicacion }, select: { id: true, siteId: true } })
    : null;
  if (d.ubicacion && !ubic) throw new ErrorApi(404, "UBICACION_NO_ENCONTRADA", `No existe la ubicación «${d.ubicacion}».`);

  const number = await nextRequestNumber(org);
  const s = await prisma.workRequest.create({
    data: {
      organizationId: org, number, title: d.titulo, description: d.descripcion ?? null, priority: d.prioridad,
      assetId: activo?.id ?? null, siteId: activo?.siteId ?? ubic?.siteId ?? null, locationId: ubic?.id ?? activo?.locationId ?? null,
      // No hay persona detrás: queda a nombre de la integración.
      requestedById: null, reporterNombre: `Integración: ${quien.nombre}`.slice(0, 120),
    },
    select: { id: true, number: true, title: true, priority: true, riesgo: true, siteId: true, requestedById: true, status: true, createdAt: true },
  });
  await avisarSolicitudNueva(org, s, { cuerpo: `Llegó por la integración «${quien.nombre}».` });
  return { estado: 201, cuerpo: { id: s.id, folio: s.number, estado: s.status, creada: s.createdAt.toISOString() } };
}

// ───────────────────────────────────────────── Lecturas de medidor

export const esquemaLectura = z.object({
  medidor: z.string().trim().min(1).max(60).optional().describe("Id del medidor"),
  activo: z.string().trim().max(60).optional().describe("Código del activo, si no se da el id del medidor"),
  nombre: z.string().trim().max(120).optional().describe("Nombre del medidor dentro del activo"),
  valor: z.number().finite(),
  unidad: z.string().trim().max(20).optional(),
  fecha: fechaExterna.optional(),
  nota: z.string().trim().max(300).optional(),
}).refine((d) => d.medidor || (d.activo && d.nombre), { message: "Indique el medidor, o el activo y el nombre del medidor" });

export async function registrarLecturaExterna(quien: Identidad, cuerpo: unknown): Promise<RespuestaApi> {
  const d = validar(esquemaLectura, cuerpo);
  const org = quien.organizationId;
  const medidor = d.medidor
    ? await prisma.meter.findFirst({ where: { id: d.medidor, organizationId: org }, select: { id: true, unit: true, name: true, asset: { select: { code: true, siteId: true } } } })
    : await prisma.meter.findFirst({ where: { organizationId: org, name: d.nombre, asset: { code: d.activo } }, select: { id: true, unit: true, name: true, asset: { select: { code: true, siteId: true } } } });
  if (!medidor) throw new ErrorApi(404, "MEDIDOR_NO_ENCONTRADO", "No existe ese medidor en esta empresa.");
  if (d.unidad && d.unidad.toLowerCase() !== medidor.unit.toLowerCase()) {
    throw new ErrorApi(422, "UNIDAD_INCOMPATIBLE", `El medidor se lleva en «${medidor.unit}», no en «${d.unidad}». Convierta el valor antes de mandarlo.`);
  }
  if (d.valor < 0) throw new ErrorApi(422, "VALOR_NEGATIVO", "Un medidor no puede marcar menos de cero.");
  const readingAt = fechaValida(d.fecha);

  // Repetida: mismo medidor, mismo instante (±1 s), mismo valor.
  const repetida = await prisma.meterReading.findFirst({
    where: {
      meterId: medidor.id, organizationId: org, value: d.valor, estado: { not: "ANULADA" },
      readingAt: { gte: new Date(readingAt.getTime() - 1000), lte: new Date(readingAt.getTime() + 1000) },
    },
    select: { id: true },
  });
  if (repetida) return { estado: 200, cuerpo: { id: repetida.id, duplicada: true, mensaje: "Esa lectura ya estaba registrada; no se duplicó." } };

  try {
    const r = await registrarLectura({
      organizationId: org, meterId: medidor.id, userId: null, value: d.valor, readingAt,
      note: d.nota ?? `Integración: ${quien.nombre}`, source: "API",
    });
    if (!r.ok) {
      await avisarLecturaRechazada(org, medidor, d.valor, r.validacion.mensaje, quien.nombre);
      throw new ErrorApi(422, "LECTURA_ATIPICA", `${r.validacion.mensaje} Por la API no se aceptan lecturas atípicas: regístrela en pantalla con su justificación.`, { regla: r.validacion.codigo });
    }
    return { estado: 201, cuerpo: { id: r.lecturaId, medidor: medidor.id, valor: d.valor, fecha: readingAt.toISOString() } };
  } catch (e) {
    if (e instanceof LecturaRechazada) {
      await avisarLecturaRechazada(org, medidor, d.valor, e.validacion.mensaje, quien.nombre);
      const fuera = ["MENOR_QUE_ANTERIOR", "MAYOR_QUE_SIGUIENTE", "ROMPE_CONTINUIDAD"].includes(e.validacion.codigo);
      throw new ErrorApi(422, fuera ? "FUERA_DE_SECUENCIA" : "LECTURA_IMPOSIBLE", e.validacion.mensaje, { regla: e.validacion.codigo });
    }
    throw e;
  }
}

async function avisarLecturaRechazada(
  organizationId: string, m: { id: string; name: string; asset: { code: string; siteId: string | null } }, valor: number, motivo: string, integracion: string,
) {
  await emitirAviso({
    organizationId, tipo: "LECTURA_ANORMAL", entidad: "Meter", entidadId: m.id, version: `api:${new Date().toISOString().slice(0, 13)}`,
    titulo: `Lectura rechazada: ${m.asset.code} · ${m.name}`,
    cuerpo: `La integración «${integracion}» mandó ${valor}. ${motivo}`,
    porQue: "El medidor no recibió la lectura: si el dato es real, el plan por uso no se entera.",
    accion: "Revise el medidor o la integración; si la lectura es correcta, captúrela en pantalla con su justificación.",
    enlace: "/meters", contexto: { siteId: m.asset.siteId }, datos: { medidor: m.name, activo: m.asset.code },
  });
}

// ───────────────────────────────────────────── Condiciones (sensores)

export const esquemaCondicion = z.object({
  sensor: z.string().trim().min(1).max(60).describe("Id del sensor"),
  valor: z.number().finite(),
  unidad: z.string().trim().max(20).optional(),
  fecha: fechaExterna.optional(),
});

export async function registrarCondicionExterna(quien: Identidad, cuerpo: unknown): Promise<RespuestaApi> {
  const d = validar(esquemaCondicion, cuerpo);
  const org = quien.organizationId;
  const sensor = await prisma.sensor.findFirst({ where: { id: d.sensor, organizationId: org, active: true }, select: { id: true, unit: true } });
  if (!sensor) throw new ErrorApi(404, "SENSOR_NO_ENCONTRADO", "No existe ese sensor activo en esta empresa.");
  if (d.unidad && d.unidad.toLowerCase() !== sensor.unit.toLowerCase()) {
    throw new ErrorApi(422, "UNIDAD_INCOMPATIBLE", `El sensor mide en «${sensor.unit}», no en «${d.unidad}».`);
  }
  const readingAt = fechaValida(d.fecha);
  const repetida = await prisma.sensorReading.findFirst({
    where: { sensorId: sensor.id, organizationId: org, value: d.valor, readingAt: { gte: new Date(readingAt.getTime() - 1000), lte: new Date(readingAt.getTime() + 1000) } },
    select: { id: true },
  });
  if (repetida) return { estado: 200, cuerpo: { id: repetida.id, duplicada: true, mensaje: "Esa lectura ya estaba registrada; no se duplicó." } };
  const r = await ingestSensorReading({ organizationId: org, sensorId: sensor.id, value: d.valor, readingAt, source: "API", userId: null });
  return { estado: 201, cuerpo: { sensor: sensor.id, valor: d.valor, fecha: readingAt.toISOString(), estado: r.status } };
}
