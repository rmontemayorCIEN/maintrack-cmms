import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puedeVerRuta } from "@/lib/pantallas";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BarraMovil } from "@/components/shell/barra-movil";
import { SinPermiso } from "@/components/shell/sin-permiso";
import { EstadoConexion } from "@/components/estado-conexion";
import { BandaCliente } from "@/components/shell/banda-cliente";
import { RegistrarSW } from "@/components/registrar-sw";
import { nombreDelMapa, terminoConjunto } from "@/lib/instalaciones";
import { ZonaEmpresaProvider } from "@/components/zona-empresa";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // La guardia de pantallas por rol, para todas las páginas en un solo lugar
  // (lib/pantallas.ts). Si el rol no la ve, la página ni se consulta: se
  // responde «Sin permiso» con el menú de su rol alrededor.
  const ruta = (await headers()).get("x-ruta") ?? "/dashboard";
  const permitida = puedeVerRuta(user.role, ruta, { esSuperAdmin: user.isSuperAdmin });

  return (
    <ZonaEmpresaProvider zona={user.organization.timezone || "America/Mexico_City"}>
    <div className="flex min-h-screen">
      <RegistrarSW />
      <Sidebar
        tieneLogo={Boolean(user.organization.logoUrl)}
        orgName={user.organization.name}
        plan={user.organization.plan}
        rol={user.role}
        esSuperAdmin={user.isSuperAdmin}
        terminoConjuntoPlural={nombreDelMapa(terminoConjunto(user.organization))}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {user.actuandoComoCliente ? (
          <BandaCliente nombreCliente={user.organization.name} />
        ) : null}
        <Topbar
          user={{ name: user.name, email: user.email, role: user.role, color: user.color }}
          empresa={user.organization.name}
        />
        <EstadoConexion />
        {/* Abajo deja lugar a la barra del teléfono para que no tape contenido. */}
        <main className="flex-1 px-3 py-4 pb-24 sm:px-4 sm:py-6 lg:px-8 lg:pb-6">{permitida ? children : <SinPermiso />}</main>
      </div>
      <Suspense fallback={null}>
        <BarraMovil rol={user.role} />
      </Suspense>
    </div>
    </ZonaEmpresaProvider>
  );
}
