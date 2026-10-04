"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * Como se arman las ordenes de trabajo en esta organizacion.
 *
 * Tres decisiones que cambian segun la planta y que antes estaban fijas en el
 * codigo: si una orden puede juntar trabajo de varios origenes, que tan lejos
 * se puede adelantar un preventivo para aprovechar la vuelta, y desde donde se
 * cuenta el siguiente cuando uno se cierra tarde.
 */
export function ConfiguracionOrdenes({
  multiOrigen, horizonteDias, recalculo, diasHabiles, jornadaDias, generacion, evidenciaCriticas,
  codigoFormato, revisionFormato, editable,
}: {
  /** Pedir evidencia al completar ordenes de equipos criticos o de seguridad. */
  evidenciaCriticas: boolean;
  multiOrigen: boolean;
  horizonteDias: number;
  /** CIERRE | PROGRAMADO. Desde donde se cuenta el siguiente preventivo. */
  recalculo: string;
  /** Contar los intervalos en dias habiles en vez de corridos. */
  diasHabiles: boolean;
  /** Los dias laborables ya configurados, para poder nombrarlos aqui. */
  jornadaDias: string;
  /** AUTOMATICA | MANUAL. Quien arma las ordenes preventivas. */
  generacion: string;
  /** El codigo del formato impreso dentro del sistema de calidad del cliente. */
  codigoFormato: string | null;
  revisionFormato: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [mezcla, setMezcla] = useState(multiOrigen);
  const [dias, setDias] = useState(String(horizonteDias));
  const [desde, setDesde] = useState(recalculo === "PROGRAMADO" ? "PROGRAMADO" : "CIERRE");
  const [codigo, setCodigo] = useState(codigoFormato ?? "");
  const [revision, setRevision] = useState(revisionFormato ?? "");
  const [habiles, setHabiles] = useState(diasHabiles);
  const [evidencia, setEvidencia] = useState(evidenciaCriticas);
  const [modo, setModo] = useState(generacion === "MANUAL" ? "MANUAL" : "AUTOMATICA");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  /**
   * Los dias laborables en palabras, para no mandar al usuario a otra pestana
   * a averiguar contra que se va a contar.
   */
  const NOMBRES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const numeros = jornadaDias
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  const corrido = numeros.length > 1 && numeros.every((d, i) => i === 0 || d === numeros[i - 1] + 1);
  const nombreDias = !numeros.length
    ? ""
    : corrido
      ? `${NOMBRES[numeros[0] - 1]} a ${NOMBRES[numeros[numeros.length - 1] - 1]}`
      : numeros.map((d) => NOMBRES[d - 1]).join(", ");

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const res = await fetch("/api/work-orders/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        otMultiOrigen: mezcla,
        otHorizonteDias: Number(dias) || 0,
        recalculoPlan: desde,
        otDiasHabiles: habiles,
        otGeneracion: modo,
        otEvidenciaCriticas: evidencia,
        codigoFormatoOT: codigo.trim(),
        revisionFormatoOT: revision.trim(),
      }),
    });
    setGuardando(false);
    setMensaje(res.ok ? "Guardado." : "No fue posible guardar.");
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <div className="grid gap-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Como se arman las órdenes</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            De aquí sale que puede juntar el generador de órdenes y que tanto se puede
            adelantar un preventivo.
          </p>
        </div>

        <div>
          <label className="label">Las órdenes preventivas las arma…</label>
          <select
            className="field"
            value={modo}
            disabled={!editable}
            onChange={(e) => setModo(e.target.value)}
          >
            <option value="AUTOMATICA">El sistema, solo</option>
            <option value="MANUAL">El gestor, eligiendo actividad por actividad</option>
          </select>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
            <b>El sistema, solo</b>: cuando a un equipo le toca mantenimiento, el programador arma
            una orden con todas las actividades que caen dentro del plazo de abajo.
            <br />
            <b>El gestor</b>: el sistema no arma órdenes de calendario. Usted decide en «Armar
            una orden» qué actividades van juntas —tres de un plan con un técnico, las otras dos
            con otro—. Las que se pasen de fecha sin estar en ninguna orden se marcan como{" "}
            <b>atrasadas</b>, y quien puede armar órdenes recibe un aviso una vez al día.
            <br />
            Los planes <b>por medidor</b> se siguen generando solos en los dos casos.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={evidencia}
            disabled={!editable}
            onChange={(e) => setEvidencia(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-xs font-medium text-slate-800">
              Pedir evidencia al completar órdenes de equipos críticos o de seguridad
            </span>
            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-slate-500">
              Encendido, una orden de un equipo con criticidad A o de tipo seguridad no se puede
              completar sin al menos una foto o documento adjunto. Las demás órdenes no la piden.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={mezcla}
            disabled={!editable}
            onChange={(e) => setMezcla(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-xs font-medium text-slate-800">
              Una orden puede juntar trabajo de varios origenes
            </span>
            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-slate-500">
              El técnico baja a la bomba por el preventivo del mes y de paso atiende la fuga
              que reportaron: todo en una orden, en un viaje. Cada actividad conserva de donde
              vino, asi que los indicadores no se mezclan.
              <br />
              Apagado, cada origen lleva su propia orden y el generador solo deja elegir de un
              grupo a la vez.
            </span>
          </span>
        </label>

        <div>
          <label className="label">Cuanto se puede adelantar un preventivo (días)</label>
          <input
            type="number" inputMode="decimal"
            min="0"
            max="365"
            className="field max-w-32"
            value={dias}
            disabled={!editable}
            onChange={(e) => setDias(e.target.value)}
          />
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
            Al armar una orden se ofrecen los planes que vencen dentro de este plazo, además
            de los ya vencidos. Si el técnico ya va a bajar, adelantar el que vence en unos
            días sale mas barato que un segundo viaje.
            <br />
            En cero solo se ofrece lo que ya vencio. Adelantar de mas gasta el mantenimiento
            antes de tiempo, asi que conviene un plazo corto salvo que la planta pare pocas
            veces al ano.
          </p>
        </div>

        <div>
          <label className="label">Los intervalos en días se cuentan…</label>
          <select
            className="field"
            value={habiles ? "HABILES" : "CORRIDOS"}
            disabled={!editable}
            onChange={(e) => setHabiles(e.target.value === "HABILES")}
          >
            <option value="CORRIDOS">En días corridos</option>
            <option value="HABILES">En días hábiles</option>
          </select>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
            Un cambio de aceite «cada 15 días» que se hizo el viernes 4 de septiembre.{" "}
            <b>Corridos</b>, el siguiente cae el sábado 19. <b>Hábiles</b>, cae el martes 22:
            se cuentan 15 días de trabajo, saltando los que su empresa no labora.
            <br />
            Cuente en hábiles si el mantenimiento va por desgaste —la máquina se gasta
            operando, no en el almanaque—. Deje corridos si su programa está anclado al
            calendario.
            <br />
            Los días laborables y los festivos salen de{" "}
            <b>Jornada y calendario</b>, donde ya los tiene configurados
            {nombreDias ? <> —hoy: <b>{nombreDias}</b>—</> : null}. Esto <b>solo</b> aplica a
            intervalos en días: una actividad semanal, mensual o trimestral se cuenta siempre
            por calendario.
            <br />
            Cambiarlo <b>no recalcula lo ya programado</b>: aplica a las fechas que se
            calculen de aquí en adelante.
          </p>
        </div>

        <div>
          <label className="label">Cuando un preventivo se cierra tarde, el siguiente se cuenta…</label>
          <select
            className="field"
            value={desde}
            disabled={!editable}
            onChange={(e) => setDesde(e.target.value)}
          >
            <option value="CIERRE">Desde que se hizo de verdad</option>
            <option value="PROGRAMADO">Desde la fecha en que tocaba</option>
          </select>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-500">
            El engrasado tocaba el día 1 y se hizo el 15. <b>Desde que se hizo</b>, el siguiente
            cae 30 días después del 15: correcto cuando lo que importa es cuánto lleva operando
            el equipo desde la última vez.
            <br />
            <b>Desde la fecha en que tocaba</b>, el siguiente sigue cayendo el día 1: el
            calendario no se recorre. Correcto para trabajo anclado al calendario y para quien
            reporta cumplimiento contra un programa anual.
            <br />
            En los dos casos <b>no se salta ninguna actividad</b>: cerrar tarde mueve la fecha,
            nunca se brinca el ciclo que tocaba.
          </p>
        </div>


        {/*
          El formato controlado.

          Esto NO es la norma: es como identifica ESTA empresa la hoja dentro
          de su sistema de calidad. El auditor de ISO no busca que el papel
          diga «ISO 9001»; busca el codigo del formato registrado en su sistema
          documental. Por eso lo escribe el cliente y no sale de ningun
          catalogo nuestro, y por eso le sirve aunque nunca contrate el modulo
          de cumplimiento.
        */}
        <div className="border-t border-slate-200 pt-5">
          <h2 className="text-sm font-semibold text-slate-900">La orden impresa, como formato de su sistema de calidad</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Si su empresa está certificada, la hoja impresa lleva el código del formato y su revisión al pie.
            Déjelo vacío si no lo usa.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <label className="label" htmlFor="codigo-formato">Código del formato</label>
              <input
                id="codigo-formato" className="input" value={codigo} maxLength={40} disabled={!editable}
                onChange={(e) => setCodigo(e.target.value)} placeholder="FOR-MTTO-012"
              />
            </div>
            <div>
              <label className="label" htmlFor="revision-formato">Revisión</label>
              <input
                id="revision-formato" className="input" value={revision} maxLength={12} disabled={!editable}
                onChange={(e) => setRevision(e.target.value)} placeholder="3"
              />
            </div>
          </div>
          {codigo.trim() ? (
            <p className="mt-2 text-[0.6875rem] text-slate-500">
              En el pie de cada orden impresa se leerá:{" "}
              <span className="font-medium text-slate-700">
                {codigo.trim()}{revision.trim() ? ` · Rev. ${revision.trim()}` : ""}
              </span>
            </p>
          ) : null}
        </div>
        {editable ? (
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            {mensaje ? <span className="text-xs text-slate-500">{mensaje}</span> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
