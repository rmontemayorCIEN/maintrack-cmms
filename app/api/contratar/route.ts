import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { ErrorDeAlta, altaAbierta, darDeAltaEmpresa } from "@/lib/alta-empresa";
import { PRUEBA_DIAS } from "@/lib/comercial";
import { demasiadas, esquemaProspecto, registrarProspecto } from "@/lib/prospectos";
import { ErrorDeInicio } from "@/lib/demo";

/**
 * Contratación en línea.
 *
 * Con el alta abierta (ALLOW_PUBLIC_SIGNUP=true) crea la empresa en prueba,
 * con el plan elegido y los documentos aceptados, y abre la puesta en marcha.
 * Con el alta cerrada —la operación normal hoy— registra la solicitud y dice
 * que queda en validación: no se simula ningún pago ni se crea nada.
 */
const esquema = z.object({
  plan: z.enum(["PROFESSIONAL", "ENTERPRISE"]),
  complementoIa: z.boolean().default(false),
  giro: z.string().trim().max(60).optional(),
  modo: z.enum(["VACIA", "RECOMENDADA", "DEMO"]).default("RECOMENDADA"),
  contrasena: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(200).optional(),
  aceptaDocumentos: z.literal(true, { errorMap: () => ({ message: "Para continuar hay que aceptar los términos, el contrato y el aviso de privacidad" }) }),
});

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") return fail("Datos inválidos", 400);
  if ((cuerpo as { sitioWeb?: string }).sitioWeb) return ok({ creada: false, recibido: true }, 201);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (await demasiadas(ip)) return fail("Se recibieron demasiadas solicitudes desde esta conexión. Intente de nuevo en una hora.", 429);

  const persona = esquemaProspecto.safeParse({ ...cuerpo, tipo: "CONTRATACION", aceptaPrivacidad: (cuerpo as { aceptaDocumentos?: boolean }).aceptaDocumentos === true });
  if (!persona.success) return fail(persona.error.errors[0]?.message ?? "Revise los datos", 422, { campo: persona.error.errors[0]?.path[0] });
  const contrato = esquema.safeParse(cuerpo);
  if (!contrato.success) return fail(contrato.error.errors[0]?.message ?? "Revise los datos", 422, { campo: contrato.error.errors[0]?.path[0] });
  const p = persona.data, c = contrato.data;
  const nota = [c.complementoIa ? "Le interesa el complemento IA Avanzada." : null, `Quiere empezar: ${c.modo}.`, p.problema || null].filter(Boolean).join(" ");

  if (!altaAbierta()) {
    const { duplicado } = await registrarProspecto({ ...p, planInteres: c.plan, problema: nota });
    return ok({ creada: false, recibido: true, duplicado }, duplicado ? 200 : 201);
  }

  if (!c.contrasena) return fail("Elija una contraseña de al menos 8 caracteres", 422, { campo: "contrasena" });
  try {
    const { org, responsable } = await darDeAltaEmpresa({
      nombre: p.empresa, giro: c.giro, tipoInstalacion: p.tipoInstalacion || null, plan: c.plan, diasPrueba: PRUEBA_DIAS,
      responsable: { nombre: p.nombre, correo: p.correo, contrasena: c.contrasena }, modo: c.modo, origen: "REGISTRO", aceptoDocumentos: true,
    });
    await registrarProspecto({ ...p, planInteres: c.plan, problema: nota }, { organizationId: org.id });
    await createSession({ userId: responsable.id, organizationId: org.id, email: responsable.email, name: responsable.name, role: responsable.role });
    return ok({ creada: true, destino: "/puesta-en-marcha" }, 201);
  } catch (e) {
    if (e instanceof ErrorDeAlta) return fail(e.message, e.status);
    if (e instanceof ErrorDeInicio) return fail(e.message, e.codigo);
    throw e;
  }
}
