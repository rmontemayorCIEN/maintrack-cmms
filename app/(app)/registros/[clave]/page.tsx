import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import {
  leerRenglones, opcionesDeLlaves, puedeVerTabla, revisarCaptura, tablaPorClave, totalesDe,
} from "@/lib/registros";
import { esNumerico } from "@/lib/registros-tipos";
import { Captura } from "./captura";
import { TablaDeRegistros } from "./tabla";

export async function generateMetadata({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params;
  const user = await requireUser();
  const tabla = await tablaPorClave(user.organizationId, clave);
  return { title: tabla?.nombre ?? "Registro propio" };
}

/**
 * Una tabla propia: lo capturado, y el formulario para capturar mas.
 *
 * Quien la ve lo decide la tabla y no la ruta: dos personas del mismo rol ven
 * tablas distintas segun lo que la empresa abrio a cada rol. Por eso la guardia
 * de aqui no es `puedeVerRuta` —que ya corrio en el layout— sino `puedeVerTabla`.
 */
export default async function RegistroPage({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params;
  const user = await requireUser();
  if (!user.organization.registrosPropios) notFound();

  const tabla = await tablaPorClave(user.organizationId, clave);
  if (!tabla) notFound();

  if (!puedeVerTabla(user.role, tabla, { esSuperAdmin: user.isSuperAdmin })) {
    return (
      <div>
        <Link href="/registros" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" aria-hidden /> Registros propios
        </Link>
        <PageHeader title="Sin permiso" description="Esta tabla no está disponible para su rol." />
        <p className="text-sm text-slate-600">
          Quien la armó decidió qué roles la ven. Si necesita consultarla, pídaselo a quien administra su
          empresa: se abre por rol, sin tocar lo capturado.
        </p>
      </div>
    );
  }

  const zona = user.organization.timezone;
  const [{ renglones, hayMas, total }, catalogos] = await Promise.all([
    leerRenglones(user.organizationId, tabla),
    opcionesDeLlaves(user.organizationId, tabla.campos),
  ]);

  const totales = totalesDe(tabla, renglones);
  const puedeCapturar = revisarCaptura(user, tabla).ok;
  const numericos = tabla.campos.filter((c) => esNumerico(c.tipo));

  const filas = renglones.map((r) => ({
    id: r.id,
    folio: r.folio,
    capturoNombre: r.capturoNombre,
    creado: r.createdAt.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona }),
    valores: Object.fromEntries(
      Object.entries(r.valores).map(([k, v]) => [k, {
        texto: v.texto,
        // El orden usa el valor real: un importe como texto ordena «1,200»
        // antes que «900», y una fecha en orden alfabetico de mes.
        orden: v.crudo instanceof Date ? v.crudo.getTime() : typeof v.crudo === "number" ? v.crudo : v.texto,
        perdida: v.referenciaPerdida,
      }]),
    ),
  }));

  return (
    <div>
      <Link href="/registros" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Registros propios
      </Link>

      <PageHeader
        title={tabla.nombre}
        description={tabla.descripcion}
        actions={
          puedeCapturar
            ? <Captura tablaId={tabla.id} campos={tabla.campos} catalogos={catalogos} />
            : undefined
        }
      />

      {!tabla.activa ? (
        <div className="mb-4">
          <Badge tone="muted">Apagada</Badge>
          <span className="ml-2 text-xs text-slate-500">
            Se sigue consultando y ya no se captura. Lo que se llenó aquí se conserva.
          </span>
        </div>
      ) : null}

      {renglones.length ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Renglones" value={total.toLocaleString("es-MX")} />
          {/* Los totales los calcula TypeScript sobre lo que esta en pantalla: un
              total que saliera de otra consulta podria no cuadrar con la lista
              de enfrente, y entonces nadie sabe cual de los dos numeros sirve. */}
          {numericos.slice(0, 3).map((c) => {
            const t = totales[c.clave];
            const conDato = (t?.conteo ?? 0) > 0;
            return (
              <Stat
                key={c.clave}
                label={`${c.etiqueta} (suma)`}
                value={
                  conDato
                    ? t.suma.toLocaleString("es-MX", {
                        minimumFractionDigits: c.tipo === "DINERO" ? 2 : 0,
                        maximumFractionDigits: 2,
                      })
                    : "—"
                }
                hint={conDato ? `de ${t.conteo} ${t.conteo === 1 ? "renglón" : "renglones"} con dato` : "todavía sin capturar"}
              />
            );
          })}
        </div>
      ) : null}

      {renglones.length === 0 ? (
        <EmptyState
          title="Todavía no hay nada capturado"
          description={
            puedeCapturar
              ? "Use «Capturar» para el primer renglón. Las columnas que apuntan a sus equipos, su personal o sus proveedores traen buscador: escriba la clave o parte del nombre."
              : "Su rol puede consultar esta tabla, no capturar en ella."
          }
        />
      ) : (
        <>
          <TablaDeRegistros clave={tabla.clave} campos={tabla.campos} renglones={filas} total={total} />
          {hayMas ? (
            <p className="mt-3 text-[0.625rem] text-slate-400">
              Se muestran los {renglones.length} renglones más recientes de {total.toLocaleString("es-MX")}.
              Use el filtro para encontrar uno anterior.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
