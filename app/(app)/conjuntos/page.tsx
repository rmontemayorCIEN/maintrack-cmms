import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { conjuntosDe, residualDe } from "@/lib/conjuntos";
import { nombreDelMapa, terminoConjunto } from "@/lib/instalaciones";
import { Panel } from "./panel";
import { esLente, type Lente } from "@/lib/mapa-lentes";
import { esPeriodo, ventanas, type ClavePeriodo } from "@/lib/costo-de-parar";
import { zonaDeLaEmpresa } from "@/lib/indicadores";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const user = await requireUser();
  return { title: nombreDelMapa(terminoConjunto(user.organization)) };
}

/**
 * Los conjuntos de equipos que sirven o no sirven como un todo.
 *
 * La palabra la pone el tipo de instalacion: Linea en planta, Sistema en
 * edificio, Servicio en club, Ruta en flotilla. Aqui NO se escribe ninguna de
 * las cuatro: se leen de terminoConjunto(). Si alguien teclea "Línea" en esta
 * pantalla, el dia que la abra un club va a leer una palabra que no significa
 * nada en su mundo.
 */
export default async function ConjuntosPage({
  searchParams,
}: {
  searchParams: Promise<{ lente?: string; p?: string; sitio?: string; clase?: string }>;
}) {
  const user = await requireUser();
  const orgId = user.organizationId;
  const q = await searchParams;
  const lente: Lente = esLente(q.lente) ? q.lente : "AHORA";
  const periodo: ClavePeriodo = esPeriodo(q.p) ? q.p : "TRIMESTRE";
  // El costo solo se calcula cuando se mira «lo que costó»: es la consulta cara.
  const costo = lente === "COSTO" ? ventanas(periodo, new Date(), await zonaDeLaEmpresa(orgId)).actual : undefined;
  const editable = can(user.role, "asset:write");
  const termino = terminoConjunto(user.organization);

  const [conjuntos, residual, equipos, personas, clasificados] = await Promise.all([
    conjuntosDe(orgId, costo ? { costo } : {}),
    residualDe(orgId),
    prisma.asset.findMany({
      where: { organizationId: orgId, active: true },
      select: {
        id: true, code: true, name: true, status: true,
        location: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Cuantos equipos tienen familia. Es lo que habilita el filtro «solo
    // compresores» dentro de un lienzo, y lo mismo que hara falta el dia que
    // el sistema proponga agrupaciones solo.
    prisma.asset.count({
      where: { organizationId: orgId, active: true, categoryId: { not: null } },
    }),
  ]);

  const sitios = await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  // Que equipos trae cada conjunto, para poder editarlos sin ir al servidor de
  // nuevo. Con este volumen —decenas de conjuntos, cientos de equipos— sale
  // mas barato traerlo entero que pedirlo al abrir cada ficha.
  const membresias = await prisma.conjuntoAsset.findMany({
    where: { organizationId: orgId, conjunto: { active: true } },
    select: { conjuntoId: true, assetId: true },
  });
  const porConjunto = new Map<string, string[]>();
  for (const m of membresias) {
    porConjunto.set(m.conjuntoId, [...(porConjunto.get(m.conjuntoId) ?? []), m.assetId]);
  }

  return (
    <div>
      <PageHeader
        title={nombreDelMapa(termino)}
        description={`Sus ${termino.plural.toLowerCase()} dibujadas como de verdad están, con el estado vivo de cada equipo, lo que costaron y lo que traen pendiente. ${termino.un.charAt(0).toUpperCase()}${termino.un.slice(1)} ${termino.singular.toLowerCase()} es un grupo de equipos que sirve o no sirve como un todo y del que alguien responde; puede cruzar áreas.`}
      />
      <Panel
        termino={termino}
        conjuntos={conjuntos.map((c) => ({ ...c, assetIds: porConjunto.get(c.id) ?? [] }))}
        residual={residual}
        equipos={equipos.map((a) => ({
          id: a.id, code: a.code, name: a.name, status: a.status,
          area: a.location?.name ?? null,
          categoria: a.category?.name ?? null,
        }))}
        personas={personas}
        clasificados={clasificados}
        editable={editable}
        lente={lente}
        periodo={periodo}
        sitios={sitios}
        filtroSitio={q.sitio && sitios.some((x) => x.id === q.sitio) ? q.sitio : null}
        filtroClase={q.clase || null}
        moneda={user.organization.currency}
      />
    </div>
  );
}
