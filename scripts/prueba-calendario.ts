/**
 * La aritmetica de fechas: dias corridos, dias habiles, semanas y meses.
 *
 * Esta prueba no toca la base. Ejercita `lib/calendario.ts` directo, que es
 * donde vive la unica copia de estas cuentas.
 *
 * El caso que la origino lo dio Rafael: cambio de aceite cada 15 dias, ultima
 * vez el viernes 4 de septiembre de 2026, y la fecha correcta es el martes 22.
 * Ese resultado NO sale de contar dias corridos ni de recorrer al siguiente
 * habil —las dos dan sabado 19—: sale de contar 15 dias DE TRABAJO en una
 * planta que labora de lunes a sabado. La misma cuenta con jornada de lunes a
 * viernes da el 25, y por eso el parametro lee la jornada de la empresa en vez
 * de traer su propia lista de dias.
 *
 *   npx tsx scripts/prueba-calendario.ts
 */
import {
  siguienteFecha,
  sumarDiasHabiles,
  sumarMeses,
  desdeDias,
  describirIntervalo,
  diasAproximados,
  type ReglaCalendario,
} from "../lib/calendario";
import type { Jornada } from "../lib/agenda";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const dia = (s: string) => new Date(`${s}T12:00:00`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOMBRE = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const conNombre = (d: Date) => `${iso(d)} (${NOMBRE[d.getDay()]})`;

const jornadaDe = (dias: number[], festivos: { fecha: Date; nombre: string }[] = []): Jornada => ({
  horasJornada: 8,
  diasHabiles: dias,
  festivos,
});

const LUN_SAB = jornadaDe([1, 2, 3, 4, 5, 6]);
const LUN_VIE = jornadaDe([1, 2, 3, 4, 5]);

const corridos = (j: Jornada): ReglaCalendario => ({ habiles: false, jornada: j });
const habiles = (j: Jornada): ReglaCalendario => ({ habiles: true, jornada: j });

function main() {
  console.log("\nEl caso del 4 de septiembre: cada 15 días desde un viernes");
  const viernes = dia("2026-09-04");
  revisar("el 4 de septiembre de 2026 es viernes", viernes.getDay() === 5, conNombre(viernes));

  const corrido = siguienteFecha(viernes, 15, "DIAS", corridos(LUN_SAB));
  revisar("15 días corridos caen el sábado 19", iso(corrido) === "2026-09-19", conNombre(corrido));

  const habilSab = siguienteFecha(viernes, 15, "DIAS", habiles(LUN_SAB));
  revisar(
    "15 días hábiles con sábado laborable caen el martes 22",
    iso(habilSab) === "2026-09-22",
    conNombre(habilSab),
  );

  const habilVie = siguienteFecha(viernes, 15, "DIAS", habiles(LUN_VIE));
  revisar(
    "los mismos 15 hábiles con jornada lun-vie caen el viernes 25",
    iso(habilVie) === "2026-09-25",
    conNombre(habilVie),
  );

  revisar(
    "contar hábiles y contar corridos NO dan lo mismo",
    iso(habilSab) !== iso(corrido),
    `${iso(corrido)} vs ${iso(habilSab)}`,
  );

  console.log("\nContar hábiles nunca cae en día no laborable");
  let todosHabiles = true;
  for (let n = 1; n <= 40; n++) {
    const d = sumarDiasHabiles(viernes, n, LUN_VIE);
    if (d.getDay() === 0 || d.getDay() === 6) todosHabiles = false;
  }
  revisar("40 saltos seguidos, ninguno en sábado ni domingo", todosHabiles);

  console.log("\nLos días festivos también se saltan");
  const conFestivo = jornadaDe(
    [1, 2, 3, 4, 5],
    [{ fecha: dia("2026-09-16"), nombre: "Independencia" }],
  );
  const sinFestivo = sumarDiasHabiles(dia("2026-09-14"), 3, LUN_VIE);
  const salta = sumarDiasHabiles(dia("2026-09-14"), 3, conFestivo);
  revisar("sin festivo, 3 hábiles desde el lunes 14 caen el jueves 17", iso(sinFestivo) === "2026-09-17", conNombre(sinFestivo));
  revisar("con el 16 festivo, se recorren al viernes 18", iso(salta) === "2026-09-18", conNombre(salta));

  console.log("\nUna organización sin días hábiles no cuelga el programador");
  const vacia = jornadaDe([]);
  const inicio = Date.now();
  const caida = siguienteFecha(viernes, 15, "DIAS", habiles(vacia));
  revisar("cae a días corridos en vez de girar para siempre", iso(caida) === "2026-09-19", conNombre(caida));
  revisar("y responde de inmediato", Date.now() - inicio < 500);

  console.log("\nMeses de calendario: el día 31 recorta pero no se queda pegado");
  // Se ancla al dia 31 y se avanza mes con mes, como lo hace el programador.
  const cadena: string[] = [];
  let f = dia("2026-01-31");
  cadena.push(iso(f));
  for (let i = 0; i < 4; i++) {
    f = sumarMeses(f, 1, 31);
    cadena.push(iso(f));
  }
  revisar(
    "31 ene → 28 feb → 31 mar → 30 abr → 31 may",
    cadena.join(" → ") === "2026-01-31 → 2026-02-28 → 2026-03-31 → 2026-04-30 → 2026-05-31",
    cadena.join(" → "),
  );

  const bisiesto = sumarMeses(dia("2028-01-31"), 1, 31);
  revisar("en año bisiesto, 31 ene → 29 feb", iso(bisiesto) === "2028-02-29", iso(bisiesto));

  const quince = sumarMeses(dia("2026-01-15"), 1);
  revisar("un día que existe en todos los meses no se mueve: 15 ene → 15 feb", iso(quince) === "2026-02-15", iso(quince));

  const trimestre = siguienteFecha(dia("2026-01-15"), 3, "MESES", corridos(LUN_VIE));
  revisar("trimestral: 15 ene → 15 abr", iso(trimestre) === "2026-04-15", iso(trimestre));

  const finDeAnio = siguienteFecha(dia("2026-11-30"), 3, "MESES", corridos(LUN_VIE));
  revisar("cruza el año: 30 nov 2026 → 28 feb 2027", iso(finDeAnio) === "2027-02-28", iso(finDeAnio));

  console.log("\nUn mes NO son 30 días, y por eso no se corre en el año");
  let treintaDias = dia("2026-01-15");
  let porMes = dia("2026-01-15");
  for (let i = 0; i < 12; i++) {
    treintaDias = siguienteFecha(treintaDias, 30, "DIAS", corridos(LUN_VIE));
    porMes = siguienteFecha(porMes, 1, "MESES", corridos(LUN_VIE));
  }
  revisar("doce meses desde el 15 de enero caen el 15 de enero", iso(porMes) === "2027-01-15", iso(porMes));
  revisar(
    "doce veces 30 días se corren cinco días",
    iso(treintaDias) === "2027-01-10",
    `${iso(treintaDias)} vs ${iso(porMes)}`,
  );

  console.log("\n«Cada lunes» sale del ancla, sin necesitar un tipo propio");
  let lunes = dia("2026-09-07");
  revisar("el 7 de septiembre de 2026 es lunes", lunes.getDay() === 1, conNombre(lunes));
  let siempreLunes = true;
  for (let i = 0; i < 10; i++) {
    lunes = siguienteFecha(lunes, 1, "SEMANAS", habiles(LUN_SAB));
    if (lunes.getDay() !== 1) siempreLunes = false;
  }
  revisar(
    "diez semanas seguidas, siempre lunes, aunque la empresa cuente hábiles",
    siempreLunes,
    conNombre(lunes),
  );

  console.log("\nLos días hábiles NO tocan semanas ni meses");
  const semC = siguienteFecha(dia("2026-09-04"), 2, "SEMANAS", corridos(LUN_VIE));
  const semH = siguienteFecha(dia("2026-09-04"), 2, "SEMANAS", habiles(LUN_VIE));
  revisar("dos semanas dan lo mismo con y sin hábiles", iso(semC) === iso(semH), iso(semH));
  const mesC = siguienteFecha(dia("2026-09-04"), 1, "MESES", corridos(LUN_VIE));
  const mesH = siguienteFecha(dia("2026-09-04"), 1, "MESES", habiles(LUN_VIE));
  revisar("un mes da lo mismo con y sin hábiles", iso(mesC) === iso(mesH), iso(mesH));

  console.log("\nTraducir los días viejos a la unidad que la persona diría");
  const casos: Array<[number, string]> = [
    [30, "1 MESES"],
    [90, "3 MESES"],
    [180, "6 MESES"],
    [365, "12 MESES"],
    [7, "1 SEMANAS"],
    [14, "2 SEMANAS"],
    [15, "15 DIAS"],
    [100, "100 DIAS"],
    [45, "45 DIAS"],
  ];
  for (const [dias, esperado] of casos) {
    const r = desdeDias(dias);
    revisar(`${dias} días → ${esperado}`, `${r.cadaCuanto} ${r.unidad}` === esperado, `${r.cadaCuanto} ${r.unidad}`);
  }

  console.log("\nLo que NO debe pasar");
  const cero = siguienteFecha(viernes, 0, "DIAS", corridos(LUN_VIE));
  revisar("un intervalo en cero no devuelve la misma fecha (sería un ciclo)", iso(cero) === "2026-09-05", iso(cero));
  const negativo = siguienteFecha(viernes, -5, "DIAS", corridos(LUN_VIE));
  revisar("un intervalo negativo tampoco va hacia atrás", negativo > viernes, iso(negativo));

  console.log("\nCómo se lee en pantalla");
  const etiquetas: Array<[number, "DIAS" | "SEMANAS" | "MESES", string]> = [
    [1, "MESES", "Mensual"],
    [3, "MESES", "Trimestral"],
    [6, "MESES", "Semestral"],
    [12, "MESES", "Anual"],
    [1, "SEMANAS", "Semanal"],
    [2, "SEMANAS", "Quincenal"],
    [15, "DIAS", "Cada 15 días"],
  ];
  for (const [n, u, esperado] of etiquetas) {
    revisar(`${n} ${u} se lee «${esperado}»`, describirIntervalo(n, u) === esperado, describirIntervalo(n, u));
  }
  revisar("trimestral aproxima 91 días para ordenar", diasAproximados(3, "MESES") === 91, String(diasAproximados(3, "MESES")));

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main();
