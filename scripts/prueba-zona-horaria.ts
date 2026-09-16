/**
 * Las fechas de DIA COMPLETO no se recorren un dia por la zona horaria.
 *
 * Produccion corre en UTC y el navegador en Mexico. En la base conviven dos
 * clases de dia: la medianoche UTC que calcula el servidor (`startOfDay` en
 * Cloud Run) y la medianoche de Mexico que manda el navegador (06:00 UTC). Un
 * `new Date("...T00:00:00Z").getDate()` en Mexico da el dia ANTERIOR, y asi el
 * calendario pintaba cada numero y cada dia de la semana corridos.
 *
 * La prueba fija la zona a Monterrey —la de quien mira— antes de tocar una
 * fecha, para ejercitar el caso real y no el de la maquina donde corra.
 *
 *   npx tsx scripts/prueba-zona-horaria.ts
 */
process.env.TZ = "America/Monterrey";

import { claveDia, diaDeCalendario, dueLabel, formatDia } from "../lib/utils";
import { parseDate } from "../lib/api";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

function main() {
  revisar("la prueba corre con hora de Monterrey", new Date("2026-09-17T00:00:00Z").getHours() === 18,
    new Date("2026-09-17T00:00:00Z").toString());

  console.log("\nEl dia que representa una fecha");
  const servidor = diaDeCalendario("2026-09-17T00:00:00.000Z"); // proximaEl de CNC-202
  revisar("medianoche UTC (servidor) es el 17, jueves",
    servidor.getDate() === 17 && servidor.getDay() === 4, servidor.toString());
  const navegador = diaDeCalendario("2026-09-15T06:00:00.000Z"); // dueDate de una OT
  revisar("medianoche de México (navegador) es el 15", navegador.getDate() === 15, navegador.toString());
  const momento = diaDeCalendario("2026-09-22T05:33:45.227Z"); // 11:33 pm del 21 en Monterrey
  revisar("un momento con hora es el día local de quien mira (21)", momento.getDate() === 21, momento.toString());
  revisar("el día sale a medianoche local", servidor.getHours() === 0 && navegador.getHours() === 0);

  console.log("\nLa clave aaaa-mm-dd para un campo de fecha");
  revisar("medianoche UTC → 2026-09-17", claveDia("2026-09-17T00:00:00.000Z") === "2026-09-17", claveDia("2026-09-17T00:00:00.000Z"));
  revisar("medianoche de México → 2026-09-15", claveDia("2026-09-15T06:00:00.000Z") === "2026-09-15", claveDia("2026-09-15T06:00:00.000Z"));
  revisar("7 pm del 16 en Monterrey sigue siendo el 16 (en UTC ya es 17)",
    claveDia(new Date("2026-09-17T01:00:00.000Z")) === "2026-09-16", claveDia(new Date("2026-09-17T01:00:00.000Z")));
  revisar("meses y días de un dígito llevan cero", claveDia("2026-03-05T00:00:00.000Z") === "2026-03-05");

  console.log("\nLo que llega de un <input type=\"date\">");
  const capturado = parseDate("2026-09-21");
  revisar("parseDate lee «2026-09-21» como el 21 a medianoche local",
    !!capturado && capturado.getDate() === 21 && capturado.getHours() === 0, capturado?.toString());
  revisar("y se muestra como el 21", !!capturado && formatDia(capturado).includes("21"), capturado ? formatDia(capturado) : "");
  const conHora = parseDate("2026-09-21T15:30:00.000Z");
  revisar("un ISO completo se respeta tal cual", conHora?.toISOString() === "2026-09-21T15:30:00.000Z", conHora?.toISOString());
  revisar("vacío es null", parseDate("") === null && parseDate(null) === null);
  revisar("basura es null, no Invalid Date", parseDate("no-es-fecha") === null);

  console.log("\nEl vencimiento relativo cuenta contra el día, no contra la medianoche UTC");
  const hoy = new Date();
  const mananaUtc = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1));
  revisar("mañana calculado en el servidor dice «Vence mañana»", dueLabel(mananaUtc).text === "Vence mañana", dueLabel(mananaUtc).text);
  const hoyUtc = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  revisar("hoy calculado en el servidor dice «Vence hoy»", dueLabel(hoyUtc).text === "Vence hoy", dueLabel(hoyUtc).text);
  const hoyLocal = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  revisar("hoy capturado en el navegador también «Vence hoy»", dueLabel(hoyLocal).text === "Vence hoy", dueLabel(hoyLocal).text);
  const lejos = new Date(Date.UTC(2030, 0, 15));
  revisar("lejano se muestra con su día (15), no el 14", dueLabel(lejos).text.startsWith("15 "), dueLabel(lejos).text);
  revisar("sin fecha se dice", dueLabel(null).text === "Sin fecha");

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main();
