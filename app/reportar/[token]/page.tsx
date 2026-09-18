import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { puedeVerRuta } from "@/lib/pantallas";
import { contextoDelPunto, vistaPublicaDelPunto } from "@/lib/portal";
import { AvisoDeDatos } from "@/components/aviso-de-datos";
import { FormularioReporte } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportar una falla" };

/**
 * Portal publico de reporte. Fuera del grupo (app), asi que no pide sesion.
 *
 * Todo el contexto —empresa, sitio, ubicacion, equipo— sale del token del
 * codigo. Quien reporta no elige nada de eso ni tiene por que saberlo.
 */
export default async function ReportarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const punto = await contextoDelPunto(token);
  if (!punto) notFound();

  // Hacia afuera sale lo minimo; por dentro la solicitud conserva equipo, area
  // y planta. Lo que se enseña lo decide la configuracion del punto.
  const vista = vistaPublicaDelPunto(punto);
  const referencia = [vista.punto, vista.lugar].filter(Boolean).join(" — ");

  // QR autenticado: quien ya tiene sesión en ESTA empresa no es un visitante.
  // Se le ofrece lo que su rol puede hacer con el equipo, y el formulario
  // público queda como opción. Con sesión de otra empresa, se trata como
  // visitante: el código no abre nada de otra cuenta.
  const user = await getCurrentUser();
  const deLaEmpresa = user && user.organizationId === punto.organizationId ? user : null;
  const activo = punto.asset;
  const opciones = deLaEmpresa ? [
    activo && puedeVerRuta(deLaEmpresa.role, "/assets") ? { href: `/assets/${activo.id}`, texto: "Abrir el equipo", detalle: "Órdenes abiertas, planes, lecturas e historial" } : null,
    activo && can(deLaEmpresa.role, "workorder:write") ? { href: `/work-orders/new?activo=${activo.id}`, texto: "Crear una orden de trabajo", detalle: "Ya con este equipo" } : null,
    activo && can(deLaEmpresa.role, "workorder:execute") && puedeVerRuta(deLaEmpresa.role, "/meters") ? { href: `/assets/${activo.id}#medidores`, texto: "Registrar una lectura", detalle: "Horómetro o contador del equipo" } : null,
    can(deLaEmpresa.role, "request:create") ? { href: `/requests?nueva=1${activo ? `&activo=${activo.id}` : ""}`, texto: "Reportar con mi usuario", detalle: "Queda en «Mis reportes» y le avisamos cuando se atienda" } : null,
  ].filter((x): x is { href: string; texto: string; detalle: string } => Boolean(x)) : [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        {vista.empresa ? (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{vista.empresa}</p>
        ) : null}
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900">Reportar una falla</h1>
        {referencia ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{referencia}</span>
          </p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Ya sabemos de dónde viene el reporte. Solo díganos qué pasa.
        </p>
      </header>

      {opciones.length ? (
        <section aria-labelledby="con-sesion" className="mb-6 grid gap-2">
          <h2 id="con-sesion" className="text-sm font-semibold text-slate-900">Con su usuario, {deLaEmpresa!.name.split(" ")[0]}:</h2>
          {activo ? <p className="text-sm text-slate-600">{activo.code} · {activo.name}</p> : null}
          <ul className="grid gap-2">
            {opciones.map((o) => (
              <li key={o.href}>
                <Link href={o.href} className="flex min-h-14 flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 hover:border-brand-300 hover:bg-brand-50">
                  <span className="text-sm font-semibold text-brand-800">{o.texto}</span>
                  <span className="text-xs text-slate-500">{o.detalle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {opciones.length ? (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700">Reportar sin usuario (formulario público)</summary>
          <FormularioReporte token={token} empresa={vista.empresa} lugar={vista.lugar} />
        </details>
      ) : (
        <FormularioReporte token={token} empresa={vista.empresa} lugar={vista.lugar} />
      )}
      <AvisoDeDatos url={vista.avisoPrivacidadUrl} />
    </main>
  );
}
