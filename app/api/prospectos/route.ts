import { fail, ok } from "@/lib/api";
import { demasiadas, esquemaProspecto, registrarProspecto } from "@/lib/prospectos";

/**
 * Solicitud de demostración desde el sitio. Pública: no pide sesión.
 *
 * Contra robots: campo trampa, límite por dirección y duplicado por día. Un
 * duplicado responde igual que una solicitud nueva —no revela si el correo
 * ya estaba— pero no crea otro registro.
 */
export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") return fail("Datos inválidos", 400);
  // El robot que llena el campo trampa recibe un «recibido» y no se guarda nada.
  if ((cuerpo as { sitioWeb?: string }).sitioWeb) return ok({ recibido: true }, 201);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (await demasiadas(ip)) return fail("Se recibieron demasiadas solicitudes desde esta conexión. Intente de nuevo en una hora.", 429);
  const parsed = esquemaProspecto.safeParse({ ...cuerpo, tipo: "DEMO" });
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Revise los datos", 422, { campo: parsed.error.errors[0]?.path[0] });
  const { duplicado } = await registrarProspecto(parsed.data);
  return ok({ recibido: true, duplicado }, duplicado ? 200 : 201);
}
