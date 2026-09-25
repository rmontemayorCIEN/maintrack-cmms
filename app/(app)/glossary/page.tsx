import { requireUser } from "@/lib/auth";
import { GLOSARIO } from "@/lib/glosario";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { PageHeader } from "@/components/ui";
import { VistaGlosario } from "./vista";

export const metadata = { title: "Glosario" };

export default async function GlossaryPage() {
  const user = await requireUser();
  /**
   * Preguntar sobre un termino usa la MISMA bolsa que la ayuda con IA —es la
   * misma conversacion, anclada a un concepto en vez de a una pantalla—. Si la
   * cuenta no la tiene, el glosario sigue sirviendo como glosario y no se
   * enseña un boton que va a contestar que no esta disponible.
   */
  const conIa = iaConfigurada() && iaDeLaOrganizacion(user.organization).funciones.includes("AYUDA");
  return (
    <>
      <PageHeader
        title="Glosario de mantenimiento"
        description={`${GLOSARIO.length} terminos del vocabulario tecnico que usa el sistema. Donde aparezcan dentro de la aplicacion van subrayados con puntos: al hacer clic se abre su definicion sin salir de la pantalla.`}
      />
      <VistaGlosario terminos={GLOSARIO} conIa={conIa} />
    </>
  );
}
