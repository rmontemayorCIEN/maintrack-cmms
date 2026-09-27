import { Suspense } from "react";
import { favoritosDe } from "@/lib/favoritos";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puedeVerRuta } from "@/lib/pantallas";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BarraMovil } from "@/components/shell/barra-movil";
import { SinPermiso } from "@/components/shell/sin-permiso";
import { EstadoConexion } from "@/components/estado-conexion";
import { BandaCliente } from "@/components/shell/banda-cliente";
import { RegistrarSW } from "@/components/registrar-sw";
import { nombreDelMapa, terminoConjunto } from "@/lib/instalaciones";
import { ZonaEmpresaProvider } from "@/components/zona-empresa";
import { demoEnRestauracion } from "@/lib/api";
import { BandaDemo, DemoRestaurando } from "@/components/demo/banda";
import { RecorridoDemo } from "@/components/demo/recorrido";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // La guardia de pantallas por rol, para todas las páginas en un solo lugar
  // (lib/pantallas.ts). Si el rol no la ve, la página ni se consulta: se
  // responde «Sin permiso» con el menú de su rol alrededor.
  const ruta = (await headers()).get("x-ruta") ?? "/dashboard";
  const esDemo = user.organization.esDemo;
  // Los accesos rápidos de esta persona: ya cruzados con lo que su rol ve hoy.
  const favoritos = await favoritosDe(user.organizationId, user.id, user.role, { esSuperAdmin: user.isSuperAdmin, esDemo, registrosPropios: user.organization.registrosPropios, cumplimientoNormas: user.organization.cumplimientoNormas });
  const permitida = puedeVerRuta(user.role, ruta, { esSuperAdmin: user.isSuperAdmin, esDemo });
  // Mientras se restaura la demo no se muestra ninguna pantalla a medio sembrar.
  const restaurando = esDemo && demoEnRestauracion(user.organization);

  return (
    <ZonaEmpresaProvider zona={user.organization.timezone || "America/Mexico_City"}>
    {/* `min-h-dvh` y no `min-h-screen`: el «alto de pantalla» de CSS no
          descuenta la barra de direcciones de Safari, que aparece y desaparece
          al desplazarse. La unidad dinámica sí, y es lo que evita que la barra
          del pie quede descolocada mientras el navegador se encoge. */}
      <div className="flex min-h-dvh">
      <RegistrarSW />
      <Sidebar
        tieneLogo={Boolean(user.organization.logoUrl)}
        orgName={user.organization.name}
        plan={user.organization.plan}
        rol={user.role}
        esSuperAdmin={user.isSuperAdmin}
        esDemo={esDemo}
        registrosPropios={user.organization.registrosPropios}
        cumplimientoNormas={user.organization.cumplimientoNormas}
        favoritos={favoritos}
        terminoConjuntoPlural={nombreDelMapa(terminoConjunto(user.organization))}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {user.actuandoComoCliente ? (
          <BandaCliente nombreCliente={user.organization.name} />
        ) : null}
        <Topbar
          user={{ name: user.name, email: user.email, role: user.role, color: user.color }}
          empresa={user.organization.name}
          /* El micrófono de «llévame a…» solo si el plan lo trae. No depende
             de la llave del modelo: interpretar lo dicho no pasa por él. */
          vozNavegar={iaDeLaOrganizacion(user.organization).funciones.includes("NAVEGAR")}
          /* Solo a quien de verdad puede abrirla: la misma tabla que el menú,
             para no ofrecer un atajo que acabe en «Sin permiso». */
          consulta={puedeVerRuta(user.role, "/consulta", { esSuperAdmin: user.isSuperAdmin, esDemo })}
        />
        {esDemo ? <BandaDemo /> : null}
        <EstadoConexion />
        {/* Abajo deja lugar a la barra del teléfono para que no tape contenido. */}
        <main className="flex-1 px-3 py-4 pb-24 sm:px-4 sm:py-6 lg:px-8 lg:pb-6">{restaurando ? <DemoRestaurando /> : permitida ? children : <SinPermiso />}</main>
        {esDemo && !restaurando ? <RecorridoDemo rol={user.role} /> : null}
      </div>
      <Suspense fallback={null}>
        <BarraMovil rol={user.role} />
      </Suspense>
    </div>
    </ZonaEmpresaProvider>
  );
}
