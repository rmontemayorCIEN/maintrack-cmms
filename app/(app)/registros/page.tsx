import Link from "next/link";
import { Table2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { PERMISOS_DE_TABLA, listarTablas, rolesDe } from "@/lib/registros";
import { PLANTILLAS } from "@/lib/registros-plantillas";
import { SIN_CONTRATO } from "@/app/api/registros/contrato";

export const metadata = { title: "Registros propios" };

const etiquetaDePermiso = (permiso: string) =>
  PERMISOS_DE_TABLA.find((p) => p.permiso === permiso)?.etiqueta ?? permiso;

/**
 * Las tablas que armo esta empresa.
 *
 * Quien ve cada una lo decide la tabla, no esta pantalla: `listarTablas` ya
 * filtra por el rol. Una persona sin ninguna tabla visible ve la lista vacia y
 * eso es correcto —no un «Sin permiso», que la mandaria a pedir accesos que no
 * necesita—.
 */
export default async function RegistrosPage() {
  const user = await requireUser();
  const puedeArmar = can(user.role, "settings:write");

  if (!user.organization.registrosPropios) {
    return (
      <div>
        <PageHeader
          title="Registros propios"
          description="Las tablas que su empresa lleva aparte porque ni su ERP ni el sistema las tienen, amarradas a sus equipos y a su gente."
        />
        <Card>
          <EmptyState
            icon={<Table2 className="h-8 w-8" aria-hidden />}
            title="Todavía no está activo en su cuenta"
            description={SIN_CONTRATO}
          />
          {/* La explicacion de que es sirve de dos cosas: le dice al cliente que
              esperar, y a quien lo atiende por telefono, que ofrecerle. */}
          <div className="mt-6 border-t border-slate-200 pt-6">
            <p className="text-sm font-medium text-slate-700">Para qué sirve</p>
            <p className="mt-1 text-sm text-slate-600">
              Cada planta lleva media docena de controles en Excel: el diésel que se carga a cada equipo, el
              equipo de protección que se entrega a cada persona, el análisis del agua de la torre. No son
              mantenimiento, así que no son un módulo, pero se consultan junto al equipo y hoy viven en el
              archivo de una sola persona. Aquí se arman en unos minutos, y sus columnas apuntan a sus
              equipos, su personal y sus proveedores de verdad: no son texto que alguien volvió a escribir.
            </p>
            <p className="mt-4 text-sm font-medium text-slate-700">Se arma desde un formato ya hecho</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {PLANTILLAS.map((p) => (
                <li key={p.clave} className="rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm font-medium text-slate-800">{p.nombre}</span>
                  <p className="text-xs text-slate-500">{p.descripcion}</p>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    );
  }

  const tablas = await listarTablas(user.organizationId, {
    rol: user.role,
    esSuperAdmin: user.isSuperAdmin,
    incluirApagadas: puedeArmar,
  });

  const renglones = tablas.reduce((a, t) => a + t.renglones, 0);

  return (
    <div>
      <PageHeader
        title="Registros propios"
        description="Las tablas que armó su empresa, amarradas a sus equipos, su gente y sus proveedores."
        actions={puedeArmar ? <LinkButton href="/registros/nueva">Armar una tabla</LinkButton> : undefined}
      />

      {tablas.length ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Tablas" value={String(tablas.filter((t) => t.activa).length)} />
          <Stat label="Renglones capturados" value={renglones.toLocaleString("es-MX")} />
          <Stat label="Columnas en total" value={String(tablas.reduce((a, t) => a + t.campos.length, 0))} />
        </div>
      ) : null}

      {tablas.length === 0 ? (
        <EmptyState
          icon={<Table2 className="h-8 w-8" aria-hidden />}
          title={puedeArmar ? "Todavía no hay ninguna tabla" : "Todavía no hay tablas para su rol"}
          description={
            puedeArmar
              ? "Arme la primera desde uno de los formatos ya hechos —bitácora de combustible, entrega de equipo de protección, análisis de agua— y ajústelo, o empiece en blanco."
              : "Cuando administración arme una tabla y la abra a su rol, aparecerá aquí."
          }
          action={puedeArmar ? <LinkButton href="/registros/nueva">Ver los formatos</LinkButton> : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tablas.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/registros/${t.clave}`} className="font-medium text-slate-800 hover:underline">
                    {t.nombre}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">{t.descripcion}</p>
                </div>
                {t.activa ? null : <Badge tone="muted">Apagada</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-slate-500">
                <span className="tabular-nums">{t.renglones.toLocaleString("es-MX")} renglones</span>
                <span>{t.campos.length} columnas</span>
                <span>Captura: {etiquetaDePermiso(t.permiso)}</span>
                <span>La ven {rolesDe(t).length} roles</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {puedeArmar && tablas.length ? (
        <p className="mt-4 text-[0.625rem] text-slate-400">
          Una tabla apagada se sigue consultando y ya no se captura: lo que se llenó en ella es historia de la
          planta y no se borra. Para cambiar columnas, entre a la tabla.
        </p>
      ) : null}
    </div>
  );
}
