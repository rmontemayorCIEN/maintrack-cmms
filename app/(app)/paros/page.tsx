import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import {
  costoComparado, comoDecirlo, serieMensual, esPeriodo, type ClavePeriodo,
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
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const periodo: ClavePeriodo = esPeriodo(params.p) ? params.p : "TRIMESTRE";

  const [datos, serie] = await Promise.all([
    costoComparado(user.organizationId, periodo),
    serieMensual(user.organizationId, 12),
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
        cobertura={datos.cobertura}
        comoDecirlo={comoDecirlo(datos)}
        serie={serie}
        moneda={user.organization.currency}
      />
    </>
  );
}
