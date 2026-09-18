import { ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { estadoTecnicoPlataforma } from "@/lib/avisos/estado-plataforma";

/** Estado técnico de avisos e integraciones de todas las empresas. Solo el operador. */
export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  return ok(await estadoTecnicoPlataforma());
}
