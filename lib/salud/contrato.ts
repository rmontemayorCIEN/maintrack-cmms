// Contrato de salud, versión 1: lo que cada app le contesta a la Torre de Control.
//
// ESTE ARCHIVO ES LA FUENTE. Cada app lleva una copia en `lib/salud/contrato.ts`
// (o donde viva su `lib`) y la Torre valida la respuesta con zod en
// `lib/contrato.ts`. Si cambia algo aquí, sube `CONTRATO_VERSION` y se lleva a
// todas: la Torre acepta solo las versiones que conoce y marca las demás como
// «no se sabe», nunca como sanas.
//
// La ruta es GET /api/salud/detalle con `Authorization: Bearer <token>`:
//
//   - El token vive en Secret Manager como TORRE_SALUD_TOKEN en la app y como
//     SALUD_TOKEN_<CLAVE> en la Torre, con el MISMO valor. Lo carga Rafael desde
//     la consola web. Sin token configurado, la ruta contesta 404: nunca queda
//     abierta.
//   - SOLO conteos, estados y fechas. Ningún nombre, correo, teléfono, RFC,
//     contenido de mensaje ni identificador de cliente. El texto de `detalle` lo
//     lee una persona que quizá no debe ver datos de clientes.
//   - Nunca el valor de un secreto: a lo más «configurado» o «falta».
//   - Cada revisión tiene su propio límite de tiempo y su propio try/catch: una
//     que truena se reporta como «desconocido», no tumba el reporte entero.
//   - `Cache-Control: no-store`.

import { timingSafeEqual } from "node:crypto";

export const CONTRATO_VERSION = 1;

/// ok: funciona. atencion: funciona, pero algo va a fallar o ya va lento.
/// falla: no hace lo que se espera. desconocido: no se pudo revisar (y por eso
/// la Torre lo pinta en gris, nunca en verde).
export type EstadoRevision = "ok" | "atencion" | "falla" | "desconocido";

export type GrupoRevision =
  | "infraestructura" // base de datos, almacenamiento
  | "procesos" //       trabajos programados
  | "mensajeria" //     WhatsApp, correo, SMS
  | "llamadas" //       Vapi, Twilio
  | "notificaciones" // push al celular
  | "ia" //             errores y gasto de IA
  | "integraciones" //  Portal Superlativo, SAT, otros terceros
  | "seguridad"; //     llaves por vencer, secretos que faltan

export type Revision = {
  /// Identificador estable en kebab-case: «whatsapp-conexion», «ia-presupuesto».
  /// La Torre lleva el historial por esta clave: no la cambies.
  clave: string;
  /// Lo que lee una persona: «Conexión de WhatsApp».
  nombre: string;
  grupo: GrupoRevision;
  estado: EstadoRevision;
  /// Una frase sin datos personales: «3 de 40 llamadas fallaron en 24 h».
  detalle: string;
  /// Cifra principal, si la hay, para graficar.
  valor?: number | null;
  unidad?: string | null;
  /// Desde cuándo está en este estado, si la app lo sabe.
  desde?: string | null;
  /// Cuándo vence (llaves, tokens, certificados).
  vence?: string | null;
  /// Ruta DENTRO de la app donde se arregla («/ajustes/whatsapp»).
  arreglarEn?: string | null;
};

export type ReporteSalud = {
  contrato: typeof CONTRATO_VERSION;
  /// La clave de la app en la Torre: «maintrack», «agente-360», «avisos»…
  app: string;
  /// La revisión publicada. En Cloud Run, process.env.K_REVISION.
  version: string | null;
  generadoEn: string;
  revisiones: Revision[];
};

export const LIMITES = {
  revisiones: 60,
  clave: 60,
  nombre: 80,
  detalle: 240,
  unidad: 20,
  ruta: 200,
  /// Lo que la Torre acepta leer del cuerpo, en bytes.
  bytes: 64 * 1024,
} as const;

/// Corre una revisión con su límite de tiempo. Si truena o tarda, se reporta
/// como «desconocido» con un detalle genérico: el mensaje del error no sale
/// (puede traer una cadena de conexión o un dato), va al registro de la app.
export async function revisar(
  base: Pick<Revision, "clave" | "nombre" | "grupo">,
  fn: () => Promise<Omit<Revision, "clave" | "nombre" | "grupo">>,
  milisegundos = 5000,
): Promise<Revision> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    const limite = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error("tiempo agotado")), milisegundos);
    });
    const r = await Promise.race([fn(), limite]);
    return { ...base, ...r, detalle: recortar(r.detalle, LIMITES.detalle) };
  } catch (error) {
    console.error(`[salud] ${base.clave}:`, mensajeSeguro(error));
    return { ...base, estado: "desconocido", detalle: "No se pudo revisar; el detalle quedó en el registro de la app." };
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

export function armarReporte(app: string, revisiones: Revision[], ahora: Date = new Date()): ReporteSalud {
  return {
    contrato: CONTRATO_VERSION,
    app,
    version: process.env.K_REVISION ?? null,
    generadoEn: ahora.toISOString(),
    revisiones: revisiones.slice(0, LIMITES.revisiones),
  };
}

/// Si quien pregunta es la Torre. Comparación en tiempo constante; sin token
/// configurado (o con uno corto) nadie pasa.
export function autorizadoTorre(req: Request): boolean {
  const secreto = process.env.TORRE_SALUD_TOKEN;
  if (!secreto || secreto.length < 32) return false;
  const dado = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const esperado = Buffer.from(secreto);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

/// Un secreto configurado o no, sin tocar su valor.
export function configurado(nombreVariable: string): boolean {
  return Boolean(process.env[nombreVariable]);
}

/// El estado de algo que vence: falla si ya venció, atención si faltan menos de
/// `diasAviso` días.
export function estadoPorVencimiento(vence: Date, ahora: Date, diasAviso = 14): EstadoRevision {
  const dias = (vence.getTime() - ahora.getTime()) / 86_400_000;
  if (dias < 0) return "falla";
  if (dias < diasAviso) return "atencion";
  return "ok";
}

/// El mensaje de un error, sin credenciales: un error de base de datos puede
/// traer «postgres://usuario:clave@host», y los secretos nunca van a un registro.
export function mensajeSeguro(error: unknown): string {
  const m = error instanceof Error ? error.message : String(error);
  return m.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/gi, "$1***@").slice(0, 300);
}

function recortar(texto: string, maximo: number): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/* Ruta de ejemplo (app/api/salud/detalle/route.ts):

import { NextResponse } from "next/server";
import { armarReporte, autorizadoTorre, revisar } from "@/lib/salud/contrato";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 404 y no 401: quien no trae el token no necesita saber que la ruta existe.
  if (!autorizadoTorre(req)) return new NextResponse(null, { status: 404 });
  const ahora = new Date();
  const revisiones = await Promise.all([
    revisar({ clave: "base-de-datos", nombre: "Base de datos", grupo: "infraestructura" }, async () => {
      const t = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - t;
      return { estado: ms > 1500 ? "atencion" : "ok", detalle: `Contestó en ${ms} ms`, valor: ms, unidad: "ms" };
    }),
  ]);
  return NextResponse.json(armarReporte("mi-app", revisiones, ahora), { headers: { "Cache-Control": "no-store" } });
}
*/
