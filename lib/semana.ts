/**
 * Que semana se revisa en el calendario, y como se nombra.
 *
 * Aritmetica de dias sobre claves "aaaa-mm-dd", a mediodia UTC, para que ni
 * el servidor en UTC ni el navegador en Mexico corran el dia.
 *
 * Antes la vista de mes mandaba el dia 1 del mes: en septiembre «Revisar la
 * semana» revisaba la del 31 de agosto aunque fuera 17 de septiembre.
 */
const DIA = 86_400_000;
const aFecha = (clave: string) => new Date(`${clave}T12:00:00Z`);
const aClave = (d: Date) => d.toISOString().slice(0, 10);

/** Lunes (clave) de la semana que contiene ese dia. */
export function lunesDe(clave: string): string {
  const d = aFecha(clave);
  return aClave(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DIA));
}

/**
 * La semana a revisar segun lo que se esta viendo: en semana o dia, esa
 * semana; en mes, la semana de hoy si hoy cae en ese mes, y si no la primera
 * del mes.
 */
export function semanaARevisar(p: { vista: string; desde: string; hasta: string; hoy: string }): string {
  if (p.vista === "mes" && p.hoy >= p.desde && p.hoy <= p.hasta) return lunesDe(p.hoy);
  return lunesDe(p.desde);
}

export function rangoDeSemana(clave: string) {
  const lunes = lunesDe(clave);
  const domingo = aClave(new Date(aFecha(lunes).getTime() + 6 * DIA));
  const f = (c: string, mes: boolean) =>
    new Intl.DateTimeFormat("es-MX", { day: "numeric", ...(mes ? { month: "short" } : {}), timeZone: "UTC" }).format(aFecha(c));
  const mismoMes = lunes.slice(0, 7) === domingo.slice(0, 7);
  return { lunes, domingo, texto: `del ${f(lunes, !mismoMes)} al ${f(domingo, true)}` };
}
