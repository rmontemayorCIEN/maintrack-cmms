import { zonaDeLaEmpresa } from "@/lib/indicadores";
import { describirPeriodo } from "@/lib/periodos";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import {
  costoComparado, comoDecirlo, eventosDeParo, ventanas, esPeriodo, type ClavePeriodo,
} from "@/lib/costo-de-parar";
import { MapaDeParos } from "./mapa";

export const metadata = { title: "Dónde para la planta" };
export const dynamic = "force-dynamic";

/**
 * La planta vista desde la direccion.
 *
 * No es el tablero del gestor de mantenimiento —ordenes, cumplimiento,
 * backlog—, que son metricas de ACTIVIDAD: cuanto trabajo el area. Un dueno no
 * pregunta eso. Pregunta donde le duele, cuanto le cuesta, y si va mejorando.
 *
 * El periodo vive en la URL para que el enlace de lo que se esta viendo se
 * pueda mandar por correo, que es lo primero que hace un director con algo que
 * le sirve.
 */
export default async function ParosPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; d?: string; h?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const periodo: ClavePeriodo = esPeriodo(params.p) ? params.p : "TRIMESTRE";

  /**
   * La ventana que el director delimito arrastrando manda sobre el boton.
   *
   * Vive en la URL igual que el periodo: asi puede mandar por correo "mira
   * estas tres semanas de julio" y quien lo abra ve exactamente eso.
   */
  const d = Number(params.d);
  const hst = Number(params.h);
  const ventanaPropia =
    Number.isFinite(d) && Number.isFinite(hst) && hst > d
      ? { desde: new Date(d), hasta: new Date(hst) }
      : null;

  const zona = await zonaDeLaEmpresa(user.organizationId);
  const v = ventanas(periodo, new Date(), zona);
  const [datos, eventos] = await Promise.all([
    costoComparado(user.organizationId, periodo, undefined, ventanaPropia),
    // El latido siempre muestra el periodo completo: la ventana es una
    // seleccion DENTRO de el, y encogerlo dejaria sin contexto lo que se
    // acaba de escoger.
    eventosDeParo(user.organizationId, v.actual),
  ]);

  return (
    <>
      <PageHeader
        title="Dónde para la planta"
        description="Qué áreas detuvieron la producción, cuánto costó, y si va mejorando o empeorando."
      />
      <MapaDeParos
        periodo={periodo}
        areas={datos.areas}
        perdida={datos.perdida}
        cambio={datos.cambio}
        anterior={datos.anterior}
        horasQueDetienen={datos.horasQueDetienen}
        horasPlaneadas={datos.horasPlaneadas}
        periodoTexto={ventanaPropia
          ? `${describirPeriodo({ ...ventanaPropia, hasta: new Date(ventanaPropia.hasta.getTime() + 1), zonaHoraria: zona })} · ${zona}`
          : `${describirPeriodo({ ...v.actual, zonaHoraria: zona })} · ${zona}`}
        cobertura={datos.cobertura}
        comoDecirlo={comoDecirlo(datos)}
        eventos={eventos}
        desdeLinea={v.actual.desde.getTime()}
        hastaLinea={v.actual.hasta.getTime()}
        ventana={ventanaPropia ? { desde: d, hasta: hst } : null}
        puedeAcomodar={can(user.role, "settings:write")}
        moneda={user.organization.currency}
      />
    </>
  );
}
