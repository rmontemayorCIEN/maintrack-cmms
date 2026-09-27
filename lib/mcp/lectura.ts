/**
 * El cliente de base de datos que usan las herramientas del servidor MCP.
 *
 * ── Solo lectura por construccion, no por revision ──
 *
 * Que ninguna herramienta escriba no se deja a que cada una «se porte bien».
 * Las herramientas reciben ESTE cliente, no `prisma`, y este cliente truena
 * ante cualquier operacion que no sea de lectura. Una herramienta nueva que
 * por descuido intente un `update` falla en la primera prueba, no en
 * produccion.
 *
 * Tambien quedan fuera las consultas en crudo (`$queryRaw`, `$executeRaw`):
 * en SQL crudo no se puede distinguir una lectura de una escritura sin
 * interpretarlo, asi que no se ofrece.
 *
 * `scripts/prueba-mcp.ts` revisa ademas que `lib/mcp/herramientas.ts` no
 * importe `prisma` directo, que seria la forma de saltarse todo esto.
 */
import { prisma } from "../db";

/** Las operaciones de modelo que solo leen. Todo lo que no este aqui se rechaza. */
export const OPERACIONES_DE_LECTURA = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy",
]);

export class EscrituraRechazada extends Error {
  constructor(operacion: string, modelo?: string) {
    super(`El servidor MCP es de solo lectura: se rechazó ${modelo ? `${modelo}.` : ""}${operacion}.`);
  }
}

const extendido = prisma.$extends({
  name: "mcp-solo-lectura",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!OPERACIONES_DE_LECTURA.has(operation)) throw new EscrituraRechazada(operation, model);
        return query(args);
      },
    },
  },
});

/**
 * Lo que se le entrega a las herramientas: los modelos, y nada de
 * transacciones, SQL crudo ni conexion. Un Proxy y no un objeto armado a mano
 * para que un modelo nuevo del esquema quede cubierto sin tocar esta lista.
 */
export const lectura = new Proxy(extendido, {
  get(objetivo, propiedad, receptor) {
    if (typeof propiedad === "string" && propiedad.startsWith("$")) {
      throw new EscrituraRechazada(propiedad);
    }
    return Reflect.get(objetivo, propiedad, receptor);
  },
}) as unknown as Omit<typeof extendido, `$${string}`>;

export type ClienteLectura = typeof lectura;
