import { requireUser } from "@/lib/auth";
import { GLOSARIO } from "@/lib/glosario";
import { PageHeader } from "@/components/ui";
import { VistaGlosario } from "./vista";

export const metadata = { title: "Glosario" };

export default async function GlossaryPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Glosario de mantenimiento"
        description={`${GLOSARIO.length} terminos del vocabulario tecnico que usa el sistema. Donde aparezcan dentro de la aplicacion van subrayados con puntos: al hacer clic se abre su definicion sin salir de la pantalla.`}
      />
      <VistaGlosario terminos={GLOSARIO} />
    </>
  );
}
