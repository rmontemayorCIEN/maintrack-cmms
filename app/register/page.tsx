import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Crear espacio de trabajo" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  // El alta abierta se controla con la variable ALLOW_PUBLIC_SIGNUP.
  if (process.env.ALLOW_PUBLIC_SIGNUP !== "true") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">Registro cerrado</h1>
          <p className="mt-2 text-sm text-slate-500">
            Esta instancia no permite crear organizaciones nuevas. Solicite su acceso al
            administrador, que puede darlo de alta desde Configuracion.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
            Volver al inicio de sesion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <RegisterForm />
    </div>
  );
}
