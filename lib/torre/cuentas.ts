/**
 * Lo que la Torre de Control ve de cada empresa cliente (lib/torre/administracion.ts
 * es el contrato, copia IGUAL de la fuente en la Torre).
 *
 * Una sola verdad: no se calcula nada aparte. Se ejecutan las MISMAS
 * herramientas del servidor MCP del operador (listar_clientes, detalle_cliente,
 * consumo_ia) con su cliente de solo lectura, y el estado de cuenta de la
 * cobranza. Solo conteos y datos de la cuenta: nada de personas, activos ni
 * descripciones.
 *
 * Como en el MCP, si el acceso no queda en la bitacora, el dato no sale: se
 * anota directo (no con logAudit, que se traga los errores) en la organizacion
 * del operador, a nombre de la persona que firmo en la Torre.
 */

import { createHash } from "node:crypto";
import { prisma } from "../db";
import { lectura } from "../mcp/lectura";
import { buscarHerramienta, type Contexto } from "../mcp/herramientas";
import { claveDiaEnZona } from "../periodos";
import { estadoDeCuenta } from "../cobranza";
import {
  ADMIN_VERSION, armarDetalle, armarLista, responder, verificar,
  type CargaFirma, type Catalogo, type Cuenta, type EstadoCuenta,
} from "./administracion";

export const CLAVE_APP = "maintrack";
const ZONA = "America/Mexico_City";

const ESTADOS: Record<string, EstadoCuenta> = { ACTIVE: "ACTIVA", TRIAL: "PRUEBA", SUSPENDED: "SUSPENDIDA", CANCELLED: "CANCELADA" };

export const CATALOGO: Catalogo = {
  contrato: ADMIN_VERSION,
  app: CLAVE_APP,
  cuentas: { singular: "empresa", plural: "empresas" },
  campos: [
    { clave: "complementos", nombre: "Complementos", tipo: "texto" },
    { clave: "nivelAdopcion", nombre: "Adopción", tipo: "texto" },
    { clave: "modulosEnUso", nombre: "Módulos en uso (30 días)", tipo: "numero" },
    { clave: "personasActivas30", nombre: "Personas activas (30 días)", tipo: "numero" },
    { clave: "operandoDesde", nombre: "Operando desde", tipo: "fecha" },
  ],
  acciones: [],
  abrirEnApp: "/clients",
};

/** La puerta de /api/torre/admin/*: sin firma valida de la Torre, 404. */
export async function conTorre(req: Request, hacer: (carga: CargaFirma) => Promise<Response>): Promise<Response> {
  const cuerpo = req.method === "GET" ? "" : await req.text();
  const v = verificar(req, cuerpo, CLAVE_APP);
  if (!v.ok) {
    if (process.env.TORRE_ADMIN_SECRETO) console.warn(`[torre-admin] rechazada: ${v.motivo}`);
    return responder(null, 404);
  }
  try {
    return await hacer(v.carga);
  } catch (e) {
    // Al que pregunta, sin detalles internos; el motivo, al registro del servidor.
    console.error("[torre-admin] error:", e instanceof Error ? e.message : e);
    return responder({ error: "No se pudo armar la respuesta." }, 500);
  }
}

function contexto(ahora: Date): Contexto {
  return { db: lectura, zona: ZONA, ahora };
}

async function herramienta<T>(nombre: string, parametros: unknown, ctx: Contexto): Promise<T> {
  const h = buscarHerramienta(nombre);
  if (!h) throw new Error(`Falta la herramienta ${nombre} del servidor MCP.`);
  return (await h.ejecutar(h.entrada.parse(parametros), ctx)) as T;
}

type FilaCliente = {
  organizacion_id: string; nombre: string; fechaAlta: string | null; plan: string; complementos: string[];
  estado: string; pruebaVence?: string | null; operandoDesde: string | null; ultimaActividad: string | null;
  usuarios: { activos: number; conActividad30Dias: number }; modulosEnUso: string[]; nivelAdopcion: string;
};

/** Anota el acceso en la organizacion del operador. Si no se puede, el dato no sale. */
async function registrar(carga: CargaFirma, organizacionId: string | null, resumen: string) {
  const operador = await prisma.user.findFirst({ where: { isSuperAdmin: true, active: true }, orderBy: { createdAt: "asc" }, select: { organizationId: true } });
  if (!operador) throw new Error("No hay operador de la plataforma donde anotar el acceso.");
  await prisma.auditLog.create({
    data: {
      organizationId: operador.organizationId,
      userId: null,
      entity: "TorreDeControl",
      entityId: (organizacionId ?? "lista").slice(0, 100),
      action: "TORRE_ACCESS",
      summary: `Desde la Torre de Control: ${carga.persona.nombre.slice(0, 80)} ${resumen}`,
      changes: JSON.stringify({ persona: carga.persona.email, ruta: carga.ruta, organizacion: organizacionId }),
    },
  });
}

/// La herramienta del MCP trae a lo mas 200 empresas: la lista dice el total
/// real y el detalle NO depende de ella (se arma con la empresa pedida).
async function cuentas(ahora: Date): Promise<{ total: number; cuentas: Cuenta[] }> {
  const ctx = contexto(ahora);
  const hoy = claveDiaEnZona(ahora, ZONA);
  const [lista, consumo, saldos] = await Promise.all([
    herramienta<{ total: number; clientes: FilaCliente[] }>("listar_clientes", { orden: "ultima_actividad", limite: 200 }, ctx),
    herramienta<{ organizaciones: { organizacion_id: string; costoUsd: number }[] }>("consumo_ia", { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, limite: 200 }, ctx),
    lectura.invoice.groupBy({ by: ["organizationId"], where: { status: "PENDING" }, _sum: { importe: true } }),
  ]);
  const ia = new Map(consumo.organizaciones.map((o) => [o.organizacion_id, o.costoUsd]));
  const saldo = new Map(saldos.map((s) => [s.organizationId, s._sum.importe ?? 0]));
  return { total: lista.total, cuentas: lista.clientes.map((c) => aCuenta(c, ia.get(c.organizacion_id) ?? 0, saldo.get(c.organizacion_id) ?? 0)) };
}

function aCuenta(c: FilaCliente, iaUsd: number, saldo: number): Cuenta {
  return {
    id: c.organizacion_id,
    nombre: c.nombre,
    estado: ESTADOS[c.estado] ?? "ACTIVA",
    plan: c.plan,
    pruebaHasta: c.estado === "TRIAL" ? c.pruebaVence ?? null : null,
    creadaEn: c.fechaAlta ?? new Date(0).toISOString(),
    usuarios: c.usuarios.activos,
    ultimoUso: c.ultimaActividad,
    iaMesUsd: Math.round(iaUsd * 100) / 100,
    saldo: Math.round(saldo * 100) / 100,
    moneda: "MXN",
    extra: {
      complementos: c.complementos.length ? c.complementos.join(", ") : "Ninguno",
      nivelAdopcion: c.nivelAdopcion,
      modulosEnUso: c.modulosEnUso.length,
      personasActivas30: c.usuarios.conActividad30Dias,
      operandoDesde: c.operandoDesde,
    },
    version: createHash("sha256").update(JSON.stringify([c.nombre, c.plan, c.estado, c.pruebaVence ?? null, c.complementos])).digest("hex").slice(0, 16),
  };
}

export async function listaParaTorre(carga: CargaFirma, ahora = new Date()) {
  const { total, cuentas: cs } = await cuentas(ahora);
  await registrar(carga, null, `vio la lista de ${cs.length} de ${total} empresas`);
  return armarLista(CLAVE_APP, cs, total, ahora);
}

type Detalle = {
  organizacion_id: string; nombre: string; plan: string; complementos: string[]; estado: string; pruebaVence?: string | null;
  fechaAlta: string | null; operandoDesde: string | null;
  adopcion: { nivel: string; modulosEnUso: number; personasDelClienteCon30DiasDeActividad: number; modulos: { modulo: string; enUso: boolean; registros30Dias: number; registrosTotales: number }[] };
  tendencia: { direccion: string; movimientosUltimas4Semanas: number; movimientos4SemanasPrevias: number };
  usuariosActivosPorRol: Record<string, number>;
};

const DIRECCION: Record<string, string> = { SUBE: "Sube", BAJA: "Baja", ESTABLE: "Estable", SIN_BASE: "Sin base para comparar", SIN_ACTIVIDAD: "Sin actividad" };

export async function detalleParaTorre(carga: CargaFirma, id: string, ahora = new Date()) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  const existe = await lectura.organization.findUnique({ where: { id }, select: { name: true } });
  if (!existe) return null;
  await registrar(carga, id, `vio el resumen de la empresa ${existe.name.slice(0, 80)}`);
  const ctx = contexto(ahora);
  const hoy = claveDiaEnZona(ahora, ZONA);
  const [d, consumo, cuenta, ultima] = await Promise.all([
    herramienta<Detalle>("detalle_cliente", { organizacion_id: id }, ctx),
    herramienta<{ organizaciones: { organizacion_id: string; costoUsd: number; funciones: { nombre: string; llamadas: number; costoUsd: number }[] }[] }>("consumo_ia", { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, organizacion_id: id, limite: 1 }, ctx),
    estadoDeCuenta(id),
    lectura.user.aggregate({ where: { organizationId: id, isSuperAdmin: false }, _max: { lastLoginAt: true } }),
  ]);
  const c = aCuenta({
    organizacion_id: d.organizacion_id, nombre: d.nombre, fechaAlta: d.fechaAlta, plan: d.plan, complementos: d.complementos,
    estado: d.estado, pruebaVence: d.pruebaVence ?? null, operandoDesde: d.operandoDesde,
    // En el detalle, la ultima entrada de la gente del cliente (la lista combina ademas su bitacora).
    ultimaActividad: ultima._max.lastLoginAt ? ultima._max.lastLoginAt.toISOString() : null,
    usuarios: { activos: Object.values(d.usuariosActivosPorRol).reduce((a, b) => a + b, 0), conActividad30Dias: d.adopcion.personasDelClienteCon30DiasDeActividad },
    modulosEnUso: d.adopcion.modulos.filter((m) => m.enUso).map((m) => m.modulo), nivelAdopcion: d.adopcion.nivel,
  }, consumo.organizaciones[0]?.costoUsd ?? 0, cuenta.saldo);
  const pesos = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
  const funciones = consumo.organizaciones[0]?.funciones ?? [];
  return armarDetalle(CLAVE_APP, c, [
    {
      titulo: "Adopción",
      filas: [
        { nombre: "Nivel", valor: d.adopcion.nivel },
        { nombre: "Módulos en uso (30 días)", valor: String(d.adopcion.modulosEnUso) },
        { nombre: "Personas del cliente activas (30 días)", valor: String(d.adopcion.personasDelClienteCon30DiasDeActividad) },
        { nombre: "Tendencia (4 semanas contra las 4 previas)", valor: `${DIRECCION[d.tendencia.direccion] ?? d.tendencia.direccion}: ${d.tendencia.movimientosUltimas4Semanas} contra ${d.tendencia.movimientos4SemanasPrevias} movimientos` },
        { nombre: "Usuarios activos por rol", valor: Object.entries(d.usuariosActivosPorRol).map(([r, n]) => `${r} ${n}`).join(" · ") || "Ninguno" },
      ],
    },
    {
      titulo: "Módulos (registros en 30 días)",
      filas: d.adopcion.modulos.map((m) => ({ nombre: m.modulo, valor: `${m.registros30Dias}${m.enUso ? " · en uso" : ""} (${m.registrosTotales} en total)` })),
    },
    {
      titulo: "Cobranza",
      filas: [
        { nombre: "Saldo", valor: pesos(cuenta.saldo) },
        { nombre: "Vencido", valor: cuenta.vencidos ? `${pesos(cuenta.vencido)} en ${cuenta.vencidos} ${cuenta.vencidos === 1 ? "cargo" : "cargos"}` : "Nada vencido" },
        { nombre: "Pagado en total", valor: pesos(cuenta.pagadoTotal) },
      ],
    },
    {
      titulo: "IA del mes",
      filas: funciones.length ? funciones.map((f) => ({ nombre: f.nombre, valor: `${f.llamadas} ${f.llamadas === 1 ? "llamada" : "llamadas"} · $${f.costoUsd.toFixed(2)} USD` })) : [{ nombre: "Llamadas", valor: "Ninguna este mes" }],
    },
  ], ahora);
}

export { responder };
