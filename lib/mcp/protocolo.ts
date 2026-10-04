/**
 * El protocolo MCP, en su forma mas simple: JSON-RPC por HTTP, sin sesion.
 *
 * ── Por que a mano y no con el SDK ──
 *
 * El servidor solo ofrece herramientas de lectura, sin recursos, sin avisos al
 * cliente y sin flujos largos. Para eso bastan cuatro metodos: initialize,
 * ping, tools/list y tools/call. El SDK oficial trae todo lo demas —sesiones,
 * SSE, reanudacion— y ademas exige una version de zod mas nueva que la del
 * proyecto. Cien lineas que se leen completas son mas faciles de auditar que
 * una dependencia de la que se usaria la decima parte.
 *
 * Sin sesion quiere decir: cada POST trae su token y se contesta con un JSON.
 * No hay `Mcp-Session-Id`, y Cloud Run puede atender cada llamada en cualquier
 * instancia.
 */
import { z } from "zod";
import { buscarHerramienta, ErrorDeHerramienta, listarHerramientas, type Contexto } from "./herramientas";
import { EscrituraRechazada } from "./lectura";

/** Versiones del protocolo que este servidor sabe hablar, de la mas nueva a la mas vieja. */
export const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26"];

export const SERVIDOR = { name: "maintrack-operador", title: "MainTrack — operador de la plataforma", version: "1.0.0" };

const INSTRUCCIONES =
  "Servidor de SOLO LECTURA con cifras agregadas del negocio de MainTrack (un CMMS SaaS) para su operador. " +
  "Empiece por resumen_plataforma o listar_clientes; use detalle_cliente con el organizacion_id que devuelve la lista. " +
  "Cada respuesta trae «criterios» (cómo se calculó) y «loQueNoSeVe» (lo que la cifra no alcanza a medir): cítelos antes de sacar conclusiones. " +
  "Para dudas de soporte de los clientes use buscar_documentacion, que devuelve la ayuda oficial de las pantallas.";

export type MensajeRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export type Llamada = {
  herramienta: string;
  parametros: unknown;
  resultado: "OK" | "ERROR" | "DESCONOCIDA";
  detalle?: string;
};

type Respuesta = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ERROR = {
  PARSE: -32700,
  PETICION: -32600,
  METODO: -32601,
  PARAMETROS: -32602,
  INTERNO: -32603,
};

const idValido = (id: unknown): id is string | number => typeof id === "string" || typeof id === "number";

function error(id: unknown, code: number, message: string): Respuesta {
  return { jsonrpc: "2.0", id: idValido(id) ? id : null, error: { code, message } };
}

const llamadaSchema = z.object({ name: z.string().min(1).max(100), arguments: z.record(z.unknown()).optional() });

/**
 * Atiende UN mensaje. Devuelve null para las notificaciones (sin id), que no
 * llevan respuesta. `registrar` se llama en cada tools/call, salga bien o mal.
 */
export async function atender(m: MensajeRpc, ctx: () => Promise<Contexto>, registrar: (l: Llamada) => Promise<void>): Promise<Respuesta | null> {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return error(m?.id, ERROR.PETICION, "Petición JSON-RPC inválida.");
  }
  const esNotificacion = m.id === undefined;
  if (esNotificacion) return null;
  if (!idValido(m.id)) return error(null, ERROR.PETICION, "El id debe ser texto o número.");
  const id = m.id;
  const ok = (result: unknown): Respuesta => ({ jsonrpc: "2.0", id, result });

  switch (m.method) {
    case "initialize": {
      const pedida = (m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const version = typeof pedida === "string" && VERSIONES.includes(pedida) ? pedida : VERSIONES[0];
      return ok({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVIDOR,
        instructions: INSTRUCCIONES,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: listarHerramientas() });
    case "tools/call": {
      const p = llamadaSchema.safeParse(m.params);
      if (!p.success) return error(id, ERROR.PARAMETROS, "tools/call necesita name y, opcionalmente, arguments como objeto.");
      const { name, arguments: args = {} } = p.data;
      const h = buscarHerramienta(name);
      if (!h) {
        // Una herramienta que no existe —«borrar_cliente», «actualizar_plan»—
        // es exactamente como se ve un intento de escritura desde aqui. Se
        // rechaza y se anota.
        await registrar({ herramienta: name, parametros: args, resultado: "DESCONOCIDA" });
        return error(id, ERROR.PARAMETROS, `No existe la herramienta «${name}». Este servidor es de solo lectura.`);
      }
      const entrada = h.entrada.safeParse(args);
      if (!entrada.success) {
        const detalle = entrada.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`).join("; ");
        await registrar({ herramienta: name, parametros: args, resultado: "ERROR", detalle });
        return ok({ isError: true, content: [{ type: "text", text: `Parámetros inválidos — ${detalle}` }] });
      }
      let datos: unknown;
      try {
        datos = await h.ejecutar(entrada.data, await ctx());
      } catch (e) {
        const esperado = e instanceof ErrorDeHerramienta || e instanceof EscrituraRechazada;
        const mensaje = esperado ? (e as Error).message : "Error interno al consultar. Quedó registrado.";
        if (!esperado) console.error("[mcp] falla interna", { herramienta: name, mensaje: (e as Error)?.message, rastro: (e as Error)?.stack?.split("\n").slice(0, 5).join(" | ") });
        await registrar({ herramienta: name, parametros: entrada.data, resultado: "ERROR", detalle: (e as Error)?.message?.slice(0, 300) });
        return ok({ isError: true, content: [{ type: "text", text: mensaje }] });
      }
      // Fuera del try a proposito: si la bitacora no se puede escribir, la
      // excepcion sube y el dato NO se entrega. Sin registro no hay respuesta.
      await registrar({ herramienta: name, parametros: entrada.data, resultado: "OK" });
      return ok({ content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] });
    }
    default:
      return error(id, ERROR.METODO, `Método no admitido: ${m.method}`);
  }
}

export { ERROR as ERRORES_RPC };
