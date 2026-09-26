import { Row } from "./fila";

/**
 * El resultado del trabajo: lo que quedó registrado, o lo que se va a pedir.
 *
 * ── Por qué está aquí y no escrito dos veces ──
 *
 * Estaba duplicado. El teléfono mostraba, en una orden sin terminar, la lista
 * de lo que se le iba a pedir al técnico; la computadora no dibujaba nada
 * —su tarjeta existía solo si la orden ya estaba completada—. O sea que un
 * supervisor revisando desde su escritorio no veía qué le falta a la orden y
 * el técnico sí, que es justo al revés de lo que conviene.
 *
 * Lo destapó un enlace: al llevar los faltantes a su sección, el de «escriba
 * la solución» apuntaba en computadora a un ancla que no existía todavía. El
 * enlace no fallaba a la vista —no pasaba nada al tocarlo— y por eso hay que
 * decirlo: era de los que callan.
 */
export function ResultadoDelTrabajo(p: {
  completado: boolean;
  resolucion: string | null;
  codigoFalla: string | null;
  causaRaiz: string | null;
  requiereParo: boolean;
  esFalla: boolean;
  evidenciaRequerida: boolean;
}) {
  if (p.completado) {
    return (
      <dl className="grid gap-3 text-sm">
        <Row label="Solución aplicada">{p.resolucion ?? "—"}</Row>
        <Row label="Código de falla">{p.codigoFalla ?? "—"}</Row>
        <Row label="Causa raíz">{p.causaRaiz ?? "—"}</Row>
      </dl>
    );
  }
  return (
    <ul className="grid list-disc gap-1 pl-5 text-sm text-slate-700">
      <li>La solución aplicada o el resumen del trabajo.</li>
      <li>Horas registradas (o por qué no hay).</li>
      {p.requiereParo ? <li>Los minutos de paro del equipo.</li> : null}
      {p.esFalla ? <li>Código de falla y causa raíz (o por qué no se determinó).</li> : null}
      <li>Todas las actividades hechas o enviadas al backlog{p.evidenciaRequerida ? ", y la evidencia" : ""}.</li>
    </ul>
  );
}
