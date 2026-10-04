import { Card, CardHeader, Progress } from "@/components/ui";
import { accionDeFamilia } from "@/lib/causas";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { CausasAgrupadas } from "@/lib/fallas";

/**
 * Por que falla la planta, agrupado por familia de causa raiz.
 *
 * ── Por que es un componente y no dos tablas ──
 *
 * Lo enseñan Reportes y «Donde para la planta». Son dos lecturas del mismo
 * numero para dos publicos —el gestor que va a cambiar el plan y el director
 * que quiere saber si le duele por mantenimiento o por operacion—, y en este
 * proyecto dos pantallas que contestan la misma pregunta responden desde
 * `lib/`. La pantalla tambien: copiarla era garantizar que un dia una
 * enseñara el costo y la otra no.
 *
 * ── Por que la cobertura va arriba y no en una nota al pie ──
 *
 * «El 40% de sus fallas son por practica de mantenimiento» es una frase que se
 * repite en una junta. Si esta dicha sobre la mitad de las fallas —porque la
 * otra mitad se cerro sin causa— es un numero preciso y falso, y el que lo
 * repite no tiene como saberlo. Asi que de cuantas fallas se esta hablando se
 * lee ANTES que los porcentajes, no despues.
 *
 * ── Por que trae que hacer con cada familia ──
 *
 * Un pico en DESGASTE y uno en OPERACION se ven igual en la tabla y se
 * atienden en areas distintas: uno cambia frecuencias del preventivo, el otro
 * es capacitacion y ningun plan de mantenimiento lo arregla. Sin eso, esto es
 * una curiosidad bien formateada.
 */
export function PorQueFalla({
  causas,
  moneda,
  titulo = "Por qué falla",
  conCostos = true,
}: {
  causas: CausasAgrupadas;
  moneda: string;
  titulo?: string;
  /** El costo no se le enseña a todos los roles; ver `verCostos`. */
  conCostos?: boolean;
}) {
  const { familias, total, conCausa, sinCausa } = causas;
  const cobertura = total ? Math.round((conCausa / total) * 100) : 0;

  return (
    <Card>
      <CardHeader
        title={titulo}
        subtitle="Familia de la causa raíz registrada al cerrar. El código de falla dice qué falló; esto, por qué."
      />

      {total === 0 ? (
        <p className="px-5 pb-6 text-center text-xs text-slate-400">
          Sin fallas codificadas en el periodo
        </p>
      ) : conCausa === 0 ? (
        /* Ninguna causa registrada. Se dice, y se dice cómo se arregla: es un
           hueco de captura, no una falla del sistema. */
        <div className="px-5 pb-6">
          <p className="text-xs text-slate-600">
            Las {total} {total === 1 ? "falla" : "fallas"} del periodo se cerraron{" "}
            <span className="font-medium text-slate-800">sin causa raíz</span>, así que
            todavía no se puede decir por qué falla la planta.
          </p>
          <p className="mt-1.5 text-[0.6875rem] text-slate-500">
            La causa se captura al cerrar la orden, junto al código de falla. Las familias
            se administran en Catálogos → Causas raíz.
          </p>
        </div>
      ) : (
        <>
          {/* De cuántas fallas se está hablando, ANTES de los porcentajes. */}
          <div className="border-b border-slate-100 px-5 pb-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-slate-600">
                Sobre <span className="font-medium tabular-nums text-slate-800">{conCausa}</span> de{" "}
                <span className="tabular-nums">{total}</span> fallas con causa registrada
              </p>
              <span className="text-xs font-medium tabular-nums text-slate-500">{cobertura}%</span>
            </div>
            <div className="mt-1.5">
              <Progress value={cobertura} tone={cobertura >= 70 ? "good" : cobertura >= 40 ? "warn" : "bad"} />
            </div>
            {sinCausa > 0 ? (
              <p className="mt-1.5 text-[0.6875rem] text-slate-500">
                {sinCausa} {sinCausa === 1 ? "falla se cerró" : "fallas se cerraron"} sin causa y no
                {sinCausa === 1 ? " entra" : " entran"} en el reparto de abajo.
              </p>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Familia</th>
                  <th className="text-right">Eventos</th>
                  <th className="text-right">Paro</th>
                  {conCostos ? <th className="text-right">Costo</th> : null}
                </tr>
              </thead>
              <tbody>
                {familias.map((f) => {
                  const accion = accionDeFamilia(f.familia);
                  return (
                    <tr key={f.familia ?? "sin-familia"}>
                      <td className="text-xs text-slate-700">
                        <span className="font-medium">{f.etiqueta}</span>
                        <span className="ml-1.5 tabular-nums text-slate-400">
                          {formatNumber(f.porcentaje, 0)}%
                        </span>
                        {accion ? (
                          <span className="mt-0.5 block text-[0.6875rem] leading-snug text-slate-500">
                            {accion}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[0.6875rem] leading-snug text-amber-700">
                            Esta causa no tiene familia asignada. Se corrige en Catálogos → Causas raíz.
                          </span>
                        )}
                      </td>
                      <td className="text-right align-top tabular-nums text-xs">{f.eventos}</td>
                      <td className="text-right align-top tabular-nums text-xs">
                        {formatNumber(f.minutosParo / 60, 1)} h
                      </td>
                      {conCostos ? (
                        <td className="text-right align-top tabular-nums text-xs">
                          {formatCurrency(f.costo, moneda)}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
