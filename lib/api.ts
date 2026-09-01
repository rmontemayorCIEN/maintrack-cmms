import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "./auth";
import { can, type Permission } from "./rbac";
import { estadoSuscripcion } from "./planes";

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status });
}

/** Envuelve un handler resolviendo sesion, tenant y permiso requerido. */
export async function withAuth<T>(
  permission: Permission | null,
  handler: (ctx: {
    user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
    orgId: string;
  }) => Promise<T>,
) {
  const user = await getCurrentUser();
  if (!user) return fail("No autenticado", 401);
  if (permission && !can(user.role, permission)) return fail("Sin permisos suficientes", 403);

  // Un `permission` no nulo siempre corresponde a una operacion que modifica
  // datos; las lecturas pasan null. Por eso el control comercial cabe aqui, en
  // un solo lugar, en vez de repetirse en cada endpoint.
  //
  // El operador de la plataforma queda exento: necesita poder entrar a una
  // cuenta vencida justamente para reactivarla o revisarla.
  if (permission && !user.isSuperAdmin) {
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
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[api]", message);
    return fail(message, 500);
  }
}

/** Etiquetas legibles para los campos que el usuario ve. */
const ETIQUETAS: Record<string, string> = {
  code: "codigo", name: "nombre", description: "descripcion", city: "ciudad",
  address: "direccion", latitud: "latitud", longitud: "longitud",
  notasAcceso: "como se entra", email: "correo", phone: "telefono",
  unitCost: "costo unitario", minQuantity: "minimo", quantity: "cantidad",
  hourlyRate: "tarifa por hora", leadTimeDays: "dias de entrega",
  intervalDays: "cada cuantos dias", estimatedHours: "horas estimadas",
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

export function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
