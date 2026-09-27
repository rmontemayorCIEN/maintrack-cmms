import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { altaAbierta } from "@/lib/alta-empresa";
import { destinoSeguro } from "@/lib/mcp/destino";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const destino = destinoSeguro((await searchParams).siguiente);
  const user = await getCurrentUser();
  if (user) redirect(destino);
  // La bandera se lee en el servidor: el navegador no ve variables de entorno.
  return <LoginForm permiteAlta={altaAbierta()} destino={destino} />;
}
