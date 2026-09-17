import { revisarRestablecimiento } from "@/lib/acceso";
import { FormularioRestablecer } from "./formulario";

export const metadata = { title: "Restablecer contraseña" };
export const dynamic = "force-dynamic";

/**
 * Pantalla publica para usar una liga de restablecimiento.
 *
 * Publica porque quien llega aqui justamente no puede entrar. Lo que la
 * protege es el token: vence en una hora, sirve una sola vez y no se guarda en
 * claro. Si no sirve, no se dice por que —vencida, usada o inventada— ni de
 * quien era.
 */
export default async function RestablecerPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valida = token ? await revisarRestablecimiento(token) : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Restablecer contraseña</h1>
        <p className="mt-1 text-xs text-slate-500">
          {valida
            ? `Hola ${valida.nombre}. Elija una contraseña nueva; al guardarla se cerrarán las sesiones abiertas de su cuenta.`
            : "Esta liga ya no sirve. Pida una nueva a su administrador."}
        </p>
      </div>
      {valida && token ? <FormularioRestablecer token={token} /> : null}
    </main>
  );
}
