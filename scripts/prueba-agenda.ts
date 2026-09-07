/**
 * Prueba de la agenda: festivos, dias habiles y carga.
 *
 * Los festivos mexicanos se calculan por regla —"tercer lunes de marzo"— y una
 * regla mal escrita da fechas creibles pero equivocadas. Por eso se comparan
 * contra fechas reales conocidas de varios anios.
 */
import { cargaPorDia, esHabil, festivosDeLey, diaSemanaIso, type Jornada } from "../lib/agenda";
import { siguienteHabil } from "../lib/scheduler";

let fallas = 0;
function revisar(etiqueta: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${etiqueta.padEnd(52)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const buscar = (anio: number, nombre: string) =>
  iso(festivosDeLey(anio).find((f) => f.nombre.includes(nombre))!.fecha);

console.log("\nFESTIVOS DE LEY, CONTRA FECHAS REALES\n");
revisar("2026: Constitucion es el 1er lunes de feb", buscar(2026, "Constitución"), "2026-02-02");
revisar("2026: Juarez es el 3er lunes de marzo", buscar(2026, "Juárez"), "2026-03-16");
revisar("2026: Revolucion es el 3er lunes de nov", buscar(2026, "Revolución"), "2026-11-16");
revisar("2025: Constitucion", buscar(2025, "Constitución"), "2025-02-03");
revisar("2025: Juarez", buscar(2025, "Juárez"), "2025-03-17");
revisar("2025: Revolucion", buscar(2025, "Revolución"), "2025-11-17");
revisar("2027: Constitucion", buscar(2027, "Constitución"), "2027-02-01");
revisar("las fijas no se mueven", [buscar(2026, "Año nuevo"), buscar(2026, "Trabajo"), buscar(2026, "Navidad")],
  ["2026-01-01", "2026-05-01", "2026-12-25"]);
revisar("transmision del poder solo cada 6 anios",
  [2024, 2025, 2026, 2030].map((a) => festivosDeLey(a).some((f) => f.nombre.includes("Transmisión"))),
  [true, false, false, true]);
revisar("todos los lunes de ley caen en lunes",
  ["Constitución", "Juárez", "Revolución"].map((n) =>
    diaSemanaIso(festivosDeLey(2026).find((f) => f.nombre.includes(n))!.fecha)),
  [1, 1, 1]);

console.log("\nDIAS HABILES\n");
const j: Jornada = {
  horasJornada: 8,
  diasHabiles: [1, 2, 3, 4, 5],
  festivos: [{ fecha: new Date(2026, 8, 16), nombre: "Independencia" }],
};
revisar("un miercoles normal es habil", esHabil(new Date(2026, 8, 9), j), true);
revisar("el sabado no", esHabil(new Date(2026, 8, 12), j), false);
revisar("el domingo no", esHabil(new Date(2026, 8, 13), j), false);
revisar("un festivo entre semana no", esHabil(new Date(2026, 8, 16), j), false);

const jSabado: Jornada = { ...j, diasHabiles: [1, 2, 3, 4, 5, 6] };
revisar("si la empresa trabaja sabado, si es habil", esHabil(new Date(2026, 8, 12), jSabado), true);

console.log("\nCARGA POR DIA Y POR PERSONA\n");
const juan = { id: "u1", name: "Juan", color: "#f00", horasDisponibles: null };
const ana = { id: "u2", name: "Ana", color: "#00f", horasDisponibles: 4 };
const martes = new Date(2026, 8, 8);
const miercoles = new Date(2026, 8, 9);
const sabado = new Date(2026, 8, 12);

const ordenes = [
  { dueDate: martes, estimatedHours: 5, status: "OPEN", assignedTo: juan },
  { dueDate: martes, estimatedHours: 4, status: "OPEN", assignedTo: juan },
  { dueDate: martes, estimatedHours: 3, status: "OPEN", assignedTo: ana },
  { dueDate: miercoles, estimatedHours: 2, status: "OPEN", assignedTo: juan },
  { dueDate: miercoles, estimatedHours: 9, status: "CLOSED", assignedTo: juan },
  { dueDate: sabado, estimatedHours: 2, status: "OPEN", assignedTo: juan },
  { dueDate: martes, estimatedHours: 6, status: "OPEN", assignedTo: null },
];
const carga = cargaPorDia([martes, miercoles, sabado], ordenes, j);

revisar("martes: 9 horas de Juan sobre 8", carga[0].personas.find((p) => p.nombre === "Juan")?.horas, 9);
revisar("martes: Juan sobrepasa su jornada", carga[0].personas.find((p) => p.nombre === "Juan")!.ocupacion > 1, true);
revisar("martes: Ana usa SU capacidad de 4", carga[0].personas.find((p) => p.nombre === "Ana")?.capacidad, 4);
revisar("martes: Ana en 3 de 4 no sobrepasa", carga[0].personas.find((p) => p.nombre === "Ana")!.ocupacion <= 1, true);
revisar("martes: lo no asignado se ve aparte", carga[0].personas.find((p) => p.userId === null)?.horas, 6);
revisar("martes queda marcado sobrecargado", carga[0].sobrecargado, true);
revisar("miercoles: la cerrada no cuenta", carga[1].horas, 2);
revisar("miercoles no esta sobrecargado", carga[1].sobrecargado, false);
revisar("sabado: capacidad cero", carga[2].personas[0]?.capacidad, 0);
revisar("trabajo en sabado sale marcado", carga[2].sobrecargado, true);
revisar("el orden es de mayor carga a menor", carga[0].personas.map((p) => p.horas), [9, 6, 3]);

console.log("\nEL PROGRAMADOR NO PROGRAMA EN DIA MUERTO\n");
// 12 de sep 2026 es sabado; 13 domingo; 14 lunes.
revisar("un sabado se recorre al lunes", iso(siguienteHabil(new Date(2026, 8, 12), j)!), "2026-09-14");
revisar("un domingo tambien", iso(siguienteHabil(new Date(2026, 8, 13), j)!), "2026-09-14");
revisar("un dia habil no se mueve", iso(siguienteHabil(new Date(2026, 8, 9), j)!), "2026-09-09");
revisar("un festivo se recorre", iso(siguienteHabil(new Date(2026, 8, 16), j)!), "2026-09-17");
revisar("nulo sigue nulo", siguienteHabil(null, j), null);
revisar("si la empresa trabaja sabado, no lo mueve",
  iso(siguienteHabil(new Date(2026, 8, 12), jSabado)!), "2026-09-12");
revisar("sin dias habiles no se cicla",
  iso(siguienteHabil(new Date(2026, 8, 12), { ...j, diasHabiles: [] })!), "2026-09-12");

console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
process.exitCode = fallas ? 1 : 0;
