import { requireUser } from "@/lib/auth";
import { GLOSARIO } from "@/lib/glosario";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { calcularIndicadores, periodoDeLaEmpresa } from "@/lib/indicadores";
import { describirPeriodo } from "@/lib/periodos";
import { puedeVerRuta } from "@/lib/pantallas";
import { CIFRA_DE_TERMINO, type CifraDeTermino } from "@/lib/glosario-cifras";
import { PageHeader } from "@/components/ui";
import { VistaGlosario } from "./vista";

export const metadata = { title: "Glosario" };
/** Trae cifras de la empresa: no se puede servir una version guardada. */
export const dynamic = "force-dynamic";

export default async function GlossaryPage() {
  const user = await requireUser();
  /**
   * Preguntar sobre un termino usa la MISMA bolsa que la ayuda con IA —es la
   * misma conversacion, anclada a un concepto en vez de a una pantalla—. Si la
   * cuenta no la tiene, el glosario sigue sirviendo como glosario y no se
   * enseña un boton que va a contestar que no esta disponible.
   */
  const conIa = iaConfigurada() && iaDeLaOrganizacion(user.organization).funciones.includes("AYUDA");

  /**
   * Las cifras solo a quien ya puede verlas en Indicadores.
   *
   * El glosario lo abre CUALQUIER rol —para eso es—, pero los indicadores de
   * la empresa son de analisis. Enseñar aqui el MTBF a quien la tabla de
   * pantallas se lo niega en Indicadores convertiria el glosario en una
   * puerta trasera, y es exactamente lo que `puedeVerRuta` existe para
   * impedir. Sin permiso, la definicion sigue completa: lo que falta es la
   * cifra, no el concepto.
   */
  const verCifras = puedeVerRuta(user.role, "/indicadores", {
    esSuperAdmin: user.isSuperAdmin,
    esDemo: user.organization.esDemo,
  });

  let cifras: Record<string, CifraDeTermino> = {};
  let periodoTexto: string | null = null;
  if (verCifras) {
    // El mismo periodo de omision de Reportes: 90 dias. Que el glosario diga
    // un numero distinto al de Reportes para el mismo indicador seria la peor
    // forma de estrenar esto.
    const periodo = await periodoDeLaEmpresa(user.organizationId, 90);
    const kpis = await calcularIndicadores(user.organizationId, periodo);
    periodoTexto = describirPeriodo(periodo);
    const porClave = kpis.indicadores as Record<string, {
      nombre: string; valor: number | null; unidad: string; calculo: string; sinValor: string | null;
    }>;
    for (const [termino, clave] of Object.entries(CIFRA_DE_TERMINO)) {
      const ind = porClave[clave];
      if (!ind) continue;
      cifras[termino] = {
        nombre: ind.nombre, valor: ind.valor, unidad: ind.unidad,
        calculo: ind.calculo, sinValor: ind.sinValor,
      };
    }
  }

  return (
    <>
      <PageHeader
        title="Glosario de mantenimiento"
        description={`${GLOSARIO.length} terminos del vocabulario tecnico que usa el sistema. Donde aparezcan dentro de la aplicacion van subrayados con puntos: al hacer clic se abre su definicion sin salir de la pantalla.`}
      />
      <VistaGlosario terminos={GLOSARIO} conIa={conIa} cifras={cifras} periodo={periodoTexto} />
    </>
  );
}
