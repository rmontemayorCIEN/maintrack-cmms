/**
 * Donde el operador dice «permitir» o «rechazar» (el formulario de
 * /oauth/autorizar).
 *
 * Aqui esta la guardia de verdad, no en la pantalla: se vuelve a validar la
 * peticion completa, la sesion y que sea operador. El formulario viaja con la
 * cookie de sesion, asi que ademas se exige que venga de este mismo origen.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitirCodigo, leerAutorizacion, origenPublico, redireccion, validarAutorizacion } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

function texto(mensaje: string, status: number) {
  return new NextResponse(mensaje, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origen = origenPublico(request);
  // Un formulario enviado desde otro sitio trae su Origin. La cookie es
  // SameSite=Lax y ya no viajaria, pero no se deja a una sola defensa.
  const desde = request.headers.get("origin");
  if (desde && desde !== origen) return texto("Origen no permitido.", 403);

  const form = new URLSearchParams(await request.text());
  const v = await validarAutorizacion(leerAutorizacion(form), origen);
  if ("fatal" in v) return texto(v.fatal!, 400);
  if ("devolver" in v) return NextResponse.redirect(v.devolver!, 303);
  const ok = v.ok!;

  const user = await getCurrentUser();
  if (!user) return texto("Su sesión terminó. Vuelva a conectar desde claude.ai.", 401);

  if (!user.isSuperAdmin) {
    await logAudit({
      organizationId: user.organizacionPropia.id, userId: user.id,
      entity: "AgenteMcp", entityId: ok.cliente.clientId, action: "MCP_RECHAZADO",
      summary: `Intento de autorizar el conector «${ok.cliente.nombre}» sin ser operador de la plataforma`,
    });
    return texto("Solo el operador de la plataforma puede autorizar este conector.", 403);
  }

  if (form.get("decision") !== "permitir") {
    return NextResponse.redirect(redireccion(ok.regreso, { error: "access_denied", error_description: "El operador rechazó el acceso.", state: ok.state }), 303);
  }

  const codigo = await emitirCodigo({
    clienteId: ok.cliente.id, userId: user.id, regreso: ok.regreso, codeChallenge: ok.codeChallenge, recurso: ok.recurso,
  });
  await logAudit({
    organizationId: user.organizacionPropia.id, userId: user.id,
    entity: "AgenteMcp", entityId: ok.cliente.clientId, action: "MCP_AUTORIZADO",
    summary: `Se autorizó el conector «${ok.cliente.nombre}» (solo lectura)`,
  });
  return NextResponse.redirect(redireccion(ok.regreso, { code: codigo, state: ok.state }), 303);
}
