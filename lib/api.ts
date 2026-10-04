import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "./auth";
import { can, type Permission } from "./rbac";
import { puedeVerRuta, verCostos } from "./pantallas";
import { estadoSuscripcion } from "./planes";
import { diaLocal } from "./utils";

/**
 * Los errores que NO son para el usuario.
 *
 * Todo lo demas que llega al manejador central son nuestras clases de regla
 * de negocio (`ErrorDeAlmacen`, `ErrorDeCompra`, `LecturaRechazada`...), cuyo
 * mensaje esta escrito para la persona y tiene que llegarle tal cual. Lo que
 * no puede salir es esto: un error de Prisma trae el nombre del modelo, los
 * campos y hasta la invocacion —«Invalid prisma.user.update() invocation»— y
 * un TypeError trae el detalle de una implementacion que al cliente no le
 * dice nada y a un curioso le dice de mas.
 */
function esInterno(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  );
}

/**
 * Contesta una falla inesperada sin contar por dentro, y la deja en el
 * registro CON contexto.
 *
 * El registro decia solo el mensaje: sin empresa, sin usuario y sin rastro,
 * un 500 en los registros de Cloud Run era irreconstruible. Lo que se escribe
 * aqui es lo unico que va a existir de ese error.
 */
export function fallaInesperada(error: unknown, quien: { userId?: string; orgId?: string } = {}) {
  const mensaje = error instanceof Error ? error.message : String(error);
  if (!esInterno(error)) {
    console.error("[api]", { mensaje, ...quien });
    return fail(mensaje, 500);
  }
  console.error("[api] falla interna", {
    tipo: error instanceof Error ? error.name : typeof error,
    mensaje,
    ...quien,
    rastro: error instanceof Error ? error.stack?.split("\n").slice(0, 6).join(" | ") : undefined,
  });
  return fail("Ocurrió un error inesperado. Vuelva a intentarlo; si sigue pasando, repórtelo desde Soporte.", 500);
}

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status });
}

/** Envuelve un handler resolviendo sesion, tenant y permiso requerido. */
export const NO_EN_DEMO = "Esto no está disponible en la empresa demostrativa.";
export const EN_RESTAURACION = "La empresa demostrativa se está restaurando. Intente de nuevo en un minuto.";

/** Un candado de restauración que quedó puesto más de 15 minutos se da por vencido (falla a medias). */
export function demoEnRestauracion(org: { demoRestaurandoDesde?: Date | null }, ahora = Date.now()) {
  return !!org.demoRestaurandoDesde && ahora - new Date(org.demoRestaurandoDesde).getTime() < 15 * 60_000;
}

export async function withAuth<T>(
  permission: Permission | null,
  handler: (ctx: {
    user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
    orgId: string;
  }) => Promise<T>,
  /**
   * `esLectura` marca un permiso que protege una CONSULTA, no una escritura.
   *
   * Existe por un caso concreto: exportar. Exportar pide permiso —no cualquiera
   * se lleva la base en un CSV— pero no escribe nada, y una cuenta con la prueba
   * vencida tiene que poder sacar su informacion. Sin esta distincion, dejar de
   * pagar equivaldria a perder el acceso a los propios datos.
   */
  opciones?: {
    esLectura?: boolean;
    /** Acciones que no se permiten en la empresa demostrativa (credenciales, webhooks). */
    noEnDemo?: boolean;
  },
) {
  const user = await getCurrentUser();
  if (!user) return fail("No autenticado", 401);
  if (permission && !can(user.role, permission)) return fail("Sin permisos suficientes", 403);

  // La empresa demostrativa (Bloque 7): mientras se restaura no atiende a
  // nadie, y lo que tocaría a la plataforma o al exterior —el plan, las
  // credenciales, los avisos a otros sistemas— no se hace desde ahí.
  const org = user.organization as { esDemo?: boolean; demoRestaurandoDesde?: Date | null };
  if (org.esDemo) {
    if (demoEnRestauracion(org)) return fail(EN_RESTAURACION, 503);
    if (!user.isSuperAdmin && (permission === "billing:manage" || opciones?.noEnDemo)) return fail(NO_EN_DEMO, 403);
  }

  // Un `permission` no nulo siempre corresponde a una operacion que modifica
  // datos; las lecturas pasan null. Por eso el control comercial cabe aqui, en
  // un solo lugar, en vez de repetirse en cada endpoint.
  //
  // El operador de la plataforma queda exento: necesita poder entrar a una
  // cuenta vencida justamente para reactivarla o revisarla.
  if (permission && !opciones?.esLectura && !user.isSuperAdmin) {
    const suscripcion = estadoSuscripcion(user.organization);
    if (suscripcion.soloLectura) return fail(suscripcion.motivo!, 402);
  }
  try {
    return (await handler({ user, orgId: user.organizationId })) as NextResponse;
  } catch (error) {
    // "Datos invalidos" a secas obliga al usuario a adivinar cual campo esta
    // mal. Se arma un mensaje que nombre el campo y diga que se esperaba.
    if (error instanceof z.ZodError) {
      return fail(mensajeDeValidacion(error), 422, error.flatten());
    }
    // Los errores de regla de negocio traen su codigo HTTP (ErrorDeOrden,
    // ErrorDeSolicitud, ErrorDeAgenda): son mensajes para la persona, no fallas.
    if (error instanceof Error && typeof (error as { codigo?: unknown }).codigo === "number") {
      const e = error as Error & { codigo: number; detalles?: unknown };
      return fail(e.message, e.codigo, e.detalles);
    }
    return fallaInesperada(error, { userId: user.id, orgId: user.organizationId });
  }
}

/**
 * Una consulta que alimenta una pantalla: la responde a quien ve esa pantalla
 * (lib/pantallas.ts). Sin esto, esconder la pantalla no servía de nada: la
 * API seguía contestando a cualquiera con sesión.
 */
export async function withVista<T>(
  ruta: string,
  handler: Parameters<typeof withAuth<T>>[1],
) {
  return withAuth<T>(null, async (ctx) => {
    if (!puedeVerRuta(ctx.user.role, ruta, { esSuperAdmin: ctx.user.isSuperAdmin })) {
      return fail("Sin permisos suficientes", 403) as unknown as T;
    }
    return handler(ctx);
  });
}

const CAMPOS_DE_COSTO = new Set([
  "laborCost", "partsCost", "serviceCost", "otherCost", "totalCost", "unitCost", "hourlyRate", "rate", "cost",
  "costoEstimado", "purchaseCost", "replacementCost", "costoUnitario",
  // Los nombres en espanol los producen las herramientas de IA, que responden
  // en prosa lo que la pantalla le oculta al mismo rol (hallazgo del Bloque 8).
  "costo", "costos", "costoSumado", "costoTotal", "costoDeReemplazo", "proporcionDelReemplazo",
  "costoDeParo", "valorInventario",
]);

/**
 * Quita los importes de una respuesta para quien no ve costos (verCostos). Se
 * aplica al salir, sobre el mismo objeto que ve quien sí los ve: no hay una
 * segunda consulta que se desincronice.
 */
export function sinCostos<T>(dato: T, rol: string | undefined): T {
  if (verCostos(rol)) return dato;
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(limpiar);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !CAMPOS_DE_COSTO.has(k)).map(([k, x]) => [k, limpiar(x)]));
    }
    return v;
  };
  return limpiar(dato) as T;
}

/** Etiquetas legibles para los campos que el usuario ve. */
const ETIQUETAS: Record<string, string> = {
  code: "codigo", name: "nombre", description: "descripcion", city: "ciudad",
  address: "direccion", latitud: "latitud", longitud: "longitud",
  notasAcceso: "como se entra", email: "correo", phone: "telefono",
  unitCost: "costo unitario", minQuantity: "minimo", quantity: "cantidad",
  hourlyRate: "tarifa por hora", leadTimeDays: "días de entrega",
  intervalDays: "cada cuantos días", estimatedHours: "horas estimadas",
};

/**
 * Traduce el error de validacion a algo accionable.
 *
 * Zod da el detalle; el usuario necesita saber que campo tocar. Los rangos se
 * explican en lugar de citarse: "fuera del rango -180 a 180" no le dice a
 * nadie que se le perdio el signo al copiar de Google Maps.
 */
function mensajeDeValidacion(error: z.ZodError): string {
  const problemas = error.issues.slice(0, 3).map((issue) => {
    const campo = issue.path.filter((p) => typeof p === "string").pop();
    const etiqueta = campo ? (ETIQUETAS[campo] ?? String(campo)) : "un dato";

    if (issue.code === "too_big" || issue.code === "too_small") {
      const limite = "maximum" in issue ? issue.maximum : "minimum" in issue ? issue.minimum : null;
      const direccion = issue.code === "too_big" ? "no puede pasar de" : "no puede ser menor a";
      return `${etiqueta}: ${direccion} ${limite}`;
    }
    if (issue.code === "invalid_type") {
      return `${etiqueta}: falta o no tiene el formato esperado`;
    }
    return `${etiqueta}: ${issue.message}`;
  });

  const unico = problemas.length === 1;
  return `Revise ${unico ? "este dato" : "estos datos"} — ${problemas.join("; ")}`;
}

/**
 * Fecha que llega del navegador. Un "aaaa-mm-dd" de un `<input type="date">` es
 * un dia, y se guarda a la medianoche local (`diaLocal`): leido como medianoche
 * UTC, en una maquina con hora de Mexico se guardaba el dia anterior.
 */
export function parseDate(value?: string | null) {
  return diaLocal(value);
}
