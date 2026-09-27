/**
 * El servidor MCP del operador de la plataforma: /api/mcp.
 *
 * Streamable HTTP sin sesion: cada POST trae su token y un mensaje JSON-RPC
 * (o un lote), y se contesta con JSON. No hay flujo SSE, asi que GET y DELETE
 * contestan 405, que es lo que la especificacion pide en ese caso.
 *
 * Todo lo que decide va en lib/mcp: el token en oauth.ts, el protocolo en
 * protocolo.ts y los datos en herramientas.ts. Aqui solo se traduce HTTP y se
 * escribe la bitacora.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { origenPublico, verificarToken } from "@/lib/mcp/oauth";
import { atender, VERSIONES, type Llamada, type MensajeRpc } from "@/lib/mcp/protocolo";
import { lectura } from "@/lib/mcp/lectura";
import { json, noAutorizado, preflight, vacio } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** Un mensaje de herramientas cabe de sobra en esto; lo que pase es otra cosa. */
const MAX_BYTES = 64 * 1024;
const MAX_LOTE = 20;
/** Lo que se guarda de los parametros en la bitacora. */
const MAX_PARAMETROS = 1000;

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return vacio(405, { Allow: "POST, OPTIONS" });
}

export function DELETE() {
  return vacio(405, { Allow: "POST, OPTIONS" });
}

export function PUT() {
  return vacio(405, { Allow: "POST, OPTIONS" });
}

export function PATCH() {
  return vacio(405, { Allow: "POST, OPTIONS" });
}

export async function POST(request: Request) {
  const origen = origenPublico(request);
  const authorization = request.headers.get("authorization");
  const v = await verificarToken(authorization, origen);

  if (!v.ok && v.status === 401) return noAutorizado(request, v.motivo, !!authorization);
  if (!v.ok) {
    // Un token bueno de alguien que ya no es operador. Se anota: es justo lo
    // que se quiere saber si alguien conserva un acceso que se le retiro.
    if (v.usuario) {
      await logAudit({
        organizationId: v.usuario.organizationId, userId: v.usuario.id,
        entity: "AgenteMcp", entityId: v.usuario.id, action: "MCP_RECHAZADO",
        summary: `Acceso de agente MCP rechazado: ${v.motivo}`,
      });
    }
    return json({ error: "forbidden", error_description: v.motivo }, 403);
  }
  const agente = v.agente;

  const version = request.headers.get("mcp-protocol-version");
  if (version && !VERSIONES.includes(version)) {
    return json({ error: `Versión de protocolo no admitida: ${version}. Admitidas: ${VERSIONES.join(", ")}` }, 400);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Se espera Content-Type: application/json" }, 415);
  }
  const texto = await request.text();
  if (Buffer.byteLength(texto) > MAX_BYTES) return json({ error: "Mensaje demasiado grande" }, 413);

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } }, 400);
  }

  const esLote = Array.isArray(cuerpo);
  const mensajes = (esLote ? cuerpo : [cuerpo]) as MensajeRpc[];
  if (!mensajes.length || mensajes.length > MAX_LOTE) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Entre 1 y ${MAX_LOTE} mensajes por petición.` } }, 400);
  }

  // La zona del operador, una vez y solo si alguna herramienta la necesita.
  let zona: string | null = null;
  const contexto = async () => {
    zona ??= (await lectura.organization.findUnique({ where: { id: agente.organizationId }, select: { timezone: true } }))?.timezone
      ?? "America/Mexico_City";
    return { db: lectura, zona, ahora: new Date() };
  };

  // Directo a la base y no con logAudit: logAudit se traga los errores a
  // proposito —la bitacora nunca rompe una operacion de negocio—, y aqui es al
  // reves. Si el acceso no queda registrado, el dato no sale.
  const registrar = async (l: Llamada) => {
    const parametros = JSON.stringify(l.parametros ?? {});
    await prisma.auditLog.create({
      data: {
        organizationId: agente.organizationId,
        userId: agente.userId,
        entity: "AgenteMcp",
        entityId: l.herramienta.slice(0, 100),
        action: "MCP_ACCESS",
        summary: `Acceso de agente MCP: ${l.herramienta.slice(0, 100)}${l.resultado === "OK" ? "" : ` (${l.resultado === "DESCONOCIDA" ? "herramienta inexistente" : "con error"})`} — ${agente.cliente}`,
        changes: JSON.stringify({
          herramienta: l.herramienta,
          parametros: parametros.length > MAX_PARAMETROS ? `${parametros.slice(0, MAX_PARAMETROS)}…` : l.parametros ?? {},
          resultado: l.resultado,
          ...(l.detalle ? { detalle: l.detalle } : {}),
          cliente: agente.cliente,
          usuario: agente.correo,
        }),
      },
    });
  };

  const respuestas = [];
  for (const m of mensajes) {
    try {
      const r = await atender(m, contexto, registrar);
      if (r) respuestas.push(r);
    } catch (e) {
      console.error("[mcp] no se pudo atender", { mensaje: (e as Error)?.message, userId: agente.userId });
      const id = typeof m?.id === "string" || typeof m?.id === "number" ? m.id : null;
      respuestas.push({ jsonrpc: "2.0" as const, id, error: { code: -32603, message: "Error interno. No se entregó ningún dato." } });
    }
  }

  // Solo notificaciones: se aceptan sin cuerpo.
  if (!respuestas.length) return vacio(202);
  return json(esLote ? respuestas : respuestas[0]);
}
