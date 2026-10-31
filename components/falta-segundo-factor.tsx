import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Lo que ve el operador de la plataforma sin segundo factor activo en una
 * pantalla que cruza empresas: qué le falta y dónde se activa, en lugar de un
 * rebote mudo al tablero.
 */
export function FaltaSegundoFactor() {
  return (
    <div className="mx-auto max-w-xl p-4">
      <Card>
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-slate-900">Active su segundo factor</p>
            <p className="mt-1 text-sm text-slate-600">
              Esta pantalla entra a los datos de todas las empresas. Para abrirla, su cuenta necesita el código de una
              aplicación autenticadora además de la contraseña.
            </p>
            <Link href="/settings?s=seguridad" className="mt-3 inline-block text-sm font-medium text-brand-700 underline">
              Activarlo en Configuración → Seguridad y sesiones
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
