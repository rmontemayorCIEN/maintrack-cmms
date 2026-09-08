import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  // La bandera se lee en el servidor: el navegador no ve variables de entorno.
  return <LoginForm permiteAlta={process.env.ALLOW_PUBLIC_SIGNUP === "true"} />;
}
