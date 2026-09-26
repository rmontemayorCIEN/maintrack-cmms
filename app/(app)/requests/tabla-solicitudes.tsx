"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { useZona } from "@/components/zona-empresa";
import { Avatar, Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import {
  PRIORITY_COLORS, PRIORITY_LABELS, REQUEST_STATUS_COLORS, REQUEST_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { ReviewActions } from "./review-actions";

/**
 * Un reporte, ya resuelto para la pantalla.
 *
 * Los textos que dependen de reglas de negocio —por que una solicitud no tiene
 * orden viva— se calculan en el servidor y viajan resueltos: `lib/reglas-ot`
 * toca la base, y arrastrarlo a un componente de cliente trae prisma al
 * navegador.
 */
export type FilaSolicitud = {
  id: string;
  numero: string;
  titulo: string;
  descripcion: string | null;
  notaDeRevision: string | null;
  adjuntos: number;
  activo: string | null;
  prioridad: string;
  estado: string;
  solicitante: string | null;
  colorSolicitante: string | null;
  creada: string;
  otId: string | null;
  otNumero: string | null;
  sinOtCorto: string | null;
  sinOtLargo: string | null;
  /** Datos que necesita el panel de revisión, para no volver a consultarlos. */
  assetId: string | null;
  tipo: string | null;
  tipoSugerido: string | null;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const FIJAS: Columna<FilaSolicitud>[] = [
  {
    id: "folio", etiqueta: "Folio", texto: (r) => r.numero,
    pinta: (r) => (
      <Link href={`/requests/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.numero}</Link>
    ),
  },
  {
    id: "reporte", etiqueta: "Reporte",
    // Se filtra por el texto completo, aunque en pantalla venga recortado.
    texto: (r) => `${r.titulo} ${r.descripcion ?? ""} ${r.notaDeRevision ?? ""}`,
    pinta: (r) => (
      <div className="max-w-72">
        <Link href={`/requests/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-brand-600">
          {r.titulo}
        </Link>
        {r.descripcion ? <p className="truncate text-xs text-slate-500">{r.descripcion}</p> : null}
        {r.notaDeRevision ? (
          <p className="mt-0.5 truncate text-xs italic text-slate-400">Nota: {r.notaDeRevision}</p>
        ) : null}
        {r.adjuntos ? (
          <p className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-slate-500">
            <Paperclip className="h-3 w-3" />
            {r.adjuntos} {r.adjuntos === 1 ? "archivo" : "archivos"}
          </p>
        ) : null}
      </div>
    ),
  },
];

function crearColumnas(zona: string, veOrdenes: boolean, conSolicitante: boolean): Columna<FilaSolicitud>[] {
  const columnas: Columna<FilaSolicitud>[] = [
    {
      id: "estado", etiqueta: "Estado", agrupable: true,
      texto: (r) => REQUEST_STATUS_LABELS[r.estado] ?? r.estado,
      pinta: (r) => <Badge className={REQUEST_STATUS_COLORS[r.estado]}>{REQUEST_STATUS_LABELS[r.estado]}</Badge>,
    },
    {
      id: "prioridad", etiqueta: "Prioridad", agrupable: true,
      texto: (r) => PRIORITY_LABELS[r.prioridad] ?? r.prioridad,
      pinta: (r) => <Badge className={PRIORITY_COLORS[r.prioridad]}>{PRIORITY_LABELS[r.prioridad]}</Badge>,
      // Urgente antes que baja: por etiqueta se ordenarian alfabeticamente.
      ordenPor: (r) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(r.prioridad),
    },
    { id: "activo", etiqueta: "Activo", agrupable: true, texto: (r) => guion(r.activo) },
  ];

  // Al solicitante no se le ofrece agrupar por quien reporto: todo es suyo.
  if (conSolicitante) {
    columnas.push({
      id: "solicitante", etiqueta: "Solicitante", agrupable: true,
      texto: (r) => guion(r.solicitante),
      pinta: (r) => (r.solicitante ? (
        <div className="flex items-center gap-2">
          <Avatar name={r.solicitante} color={r.colorSolicitante ?? undefined} />
          <span className="text-xs text-slate-600">{r.solicitante}</span>
        </div>
      ) : <span className="text-slate-400">—</span>),
    });
  }

  columnas.push(
    {
      id: "creada", etiqueta: "Fecha",
      texto: (r) => formatDateTime(new Date(r.creada), zona),
      ordenPor: (r) => new Date(r.creada).getTime(),
    },
    {
      id: "ot", etiqueta: "OT",
      texto: (r) => r.otNumero ?? r.sinOtCorto ?? "—",
      pinta: (r) => (
        <span className="text-xs">
          {r.otNumero ? (
            veOrdenes && r.otId
              ? <Link href={`/work-orders/${r.otId}`} className="text-brand-600 hover:underline">{r.otNumero}</Link>
              : <span className="text-slate-600">{r.otNumero}</span>
          ) : null}
          {r.sinOtCorto ? (
            <span className="block text-amber-700" title={r.sinOtLargo ?? undefined}>{r.sinOtCorto}</span>
          ) : r.otNumero ? null : <span className="text-slate-400">—</span>}
        </span>
      ),
    },
    { id: "adjuntos", etiqueta: "Archivos", alineaDerecha: true, texto: (r) => String(r.adjuntos), ordenPor: (r) => r.adjuntos },
  );
  return columnas;
}

/** Lo que se ve de entrada: en que va cada reporte y que tan urgente es. */
const DE_FABRICA = ["estado", "prioridad", "activo", "solicitante", "creada", "ot"];

export function TablaSolicitudes({
  solicitudes, vistaInicial, veOrdenes, conSolicitante, revision,
}: {
  solicitudes: FilaSolicitud[];
  vistaInicial: Vista;
  veOrdenes: boolean;
  conSolicitante: boolean;
  /** Quien puede revisar recibe el panel; el resto, ninguna columna de mas. */
  revision: { technicians: { id: string; name: string }[]; assets: { id: string; code: string; name: string }[] } | null;
}) {
  const zona = useZona();
  const columnas = useMemo(
    () => crearColumnas(zona, veOrdenes, conSolicitante),
    [zona, veOrdenes, conSolicitante],
  );
  return (
    <TablaConfigurable
      filas={solicitudes}
      fijas={FIJAS}
      columnas={columnas}
      deFabrica={DE_FABRICA.filter((id) => conSolicitante || id !== "solicitante")}
      vistaInicial={vistaInicial}
      clave={conSolicitante ? "solicitudes" : "mis-reportes"}
      paso={{ base: "/requests", etiqueta: (r) => `${r.numero} · ${r.titulo}` }}
      sustantivo={conSolicitante ? "solicitudes" : "reportes"}
      ejemploFiltro='Filtrar: "fuga", "bomba", "pendiente"…'
      acciones={revision
        ? (r) => (r.estado === "PENDING" ? (
            <ReviewActions
              requestId={r.id}
              technicians={revision.technicians}
              assets={revision.assets}
              assetActual={r.assetId}
              tipoActual={r.tipo}
              tipoSugerido={r.tipoSugerido}
            />
          ) : null)
        : undefined}
    />
  );
}
