import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CATALOGOS, type ClaveCatalogo } from "@/lib/catalogs";
import { PageHeader } from "@/components/ui";
import { GestorCatalogos } from "./gestor";

export const metadata = { title: "Catálogos" };
export const dynamic = "force-dynamic";

export default async function CatalogsPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const editable = can(user.role, "settings:write");

  // Los catalogos ocultos siguen sirviendo de fuente a los selects de otros,
  // pero no se listan como pestaña: tienen su propia pantalla.
  const claves = (Object.keys(CATALOGOS) as ClaveCatalogo[]).filter((c) => !CATALOGOS[c].oculto);
  const activo: ClaveCatalogo = claves.includes(params.tipo as ClaveCatalogo)
    ? (params.tipo as ClaveCatalogo)
    : "sites";

  // Se cargan todos de una vez: son listas cortas y permite cambiar de
  // pestaña sin volver al servidor.
  // Se traen TODOS los catalogos, ocultos incluidos: un select como "proveedor
  // habitual" saca sus opciones de esta tabla, y si el catalogo del que
  // depende no viene, el desplegable aparece vacio sin explicar por que.
  const datos: Record<string, Array<Record<string, unknown>>> = {};
  for (const clave of Object.keys(CATALOGOS) as ClaveCatalogo[]) {
    datos[clave] = await CATALOGOS[clave].listar(user.organizationId);
  }

  const definiciones = Object.fromEntries(
    claves.map((c) => [
      c,
      {
        titulo: CATALOGOS[c].titulo,
        singular: CATALOGOS[c].singular,
        descripcion: CATALOGOS[c].descripcion,
        campos: CATALOGOS[c].campos,
      },
    ]),
  );

  return (
    <>
      <PageHeader
        title="Catálogos maestros"
        description="Las listas que alimentan los campos de selección de todo el sistema. Lo que se da de alta aquí aparece de inmediato en las pantallas de captura."
      />
      <GestorCatalogos
        definiciones={definiciones}
        datos={datos}
        activoInicial={activo}
        editable={editable}
      />
    </>
  );
}
