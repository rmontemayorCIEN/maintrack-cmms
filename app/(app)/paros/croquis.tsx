"use client";

import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { LienzoRejilla } from "@/components/lienzo-rejilla";
import type { AreaParaCroquis } from "@/lib/croquis";

export type AreaEnCroquis = AreaParaCroquis & {
  horasQueDetienen: number;
  perdida: number;
};

/**
 * La planta como la ve su dueno, no como la ordena una grafica.
 *
 * La tira proporcional dice donde duele, pero no se parece a la planta de
 * nadie. Un director piensa en lugares —"el area de tornos, alla al fondo"— y
 * cuando el dibujo coincide con esa geografia mental deja de ser una grafica y
 * pasa a ser SU planta. Eso es lo que hace que se quede viendola.
 *
 * ── El costo de esta decision, dicho de frente ──
 *
 * En la tira, el TAMANO era el dano. Aqui el tamano es geografia, asi que ese
 * canal se pierde y todo el peso queda en el color. Se compensa poniendo horas
 * y pesos dentro de cada caja: la magnitud se lee, aunque ya no se vea de
 * lejos. Vale la pena porque reconocer la propia planta importa mas que
 * comparar areas por area.
 *
 * El gesto —rejilla, arrastre, intercambio, esquina— vive en
 * components/lienzo-rejilla.tsx, que tambien dibuja los equipos de un
 * conjunto. Aqui solo queda lo que es propio de las areas: el calor por horas
 * de paro y lo que va escrito adentro.
 */
export function Croquis({
  areas,
  moneda,
  editable,
  areaViendo,
  onVerArea,
}: {
  areas: AreaEnCroquis[];
  moneda: string;
  editable: boolean;
  areaViendo: string | null;
  onVerArea: (locationId: string | null) => void;
}) {
  const router = useRouter();

  const conId = areas.filter(
    (a): a is AreaEnCroquis & { locationId: string } => Boolean(a.locationId),
  );
  const maxHoras = Math.max(...conId.map((a) => a.horasQueDetienen), 1);

  return (
    <LienzoRejilla
      items={conId.map((a) => ({ ...a, id: a.locationId }))}
      titulo="Su planta"
      ayuda="El color es lo que dolió. Toque un área para ver qué la detuvo."
      ayudaEditando="Arrastre cada área a donde de verdad está. Jale la esquina para cambiar su tamaño."
      etiquetaEditar="Acomodar mi planta"
      etiquetaGuardar="Guardar croquis"
      editable={editable}
      activo={areaViendo}
      onTocar={onVerArea}
      nombreDe={(a) => a.area}
      color={(a) => tono(a.horasQueDetienen, maxHoras)}
      contenido={(a) => (
        <>
          <span
            className="text-[0.75rem] font-semibold leading-tight text-white drop-shadow-sm"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {a.area}
          </span>
          {/*
            El tamano de la caja ya no dice el dano —dice geografia—, asi que
            la magnitud se pone por escrito. Sin esto se pierde el canal que la
            tira proporcional si tenia.
          */}
          <span className="text-white/95">
            <span className="block text-base font-semibold leading-none tabular-nums drop-shadow-sm">
              {a.horasQueDetienen}
              <span className="text-[0.6875rem] font-medium opacity-85"> h</span>
            </span>
            {a.perdida > 0 ? (
              <span className="block text-[0.625rem] leading-tight">
                {formatCurrency(a.perdida, moneda)}
              </span>
            ) : null}
          </span>
        </>
      )}
      onGuardar={async (cajas) => {
        const res = await fetch("/api/organizacion/croquis", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // La ruta habla de ubicaciones; la rejilla no sabe de eso.
          body: JSON.stringify({ areas: cajas.map((c) => ({ ...c, locationId: c.id })) }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          return d.error ?? "No fue posible guardar el croquis";
        }
        router.refresh();
        return null;
      }}
      leyenda={
        <>
          <span>Menos paro</span>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 0.15, 0.35, 0.6, 1].map((p) => (
              <i key={p} className="block h-2.5 w-6 rounded-sm" style={{ background: tono(p, 1) }} />
            ))}
          </span>
          <span>Más paro</span>
        </>
      }
    />
  );
}

/** La rampa de calor, contra el area que mas paro. */
function tono(horas: number, max: number): string {
  const p = max > 0 ? horas / max : 0;
  if (p >= 0.75) return "#9e2f12";
  if (p >= 0.45) return "#c4522a";
  if (p >= 0.2) return "#d9622c";
  if (p > 0) return "#e08b4f";
  return "#b9c2d0";
}
