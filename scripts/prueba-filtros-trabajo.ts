/**
 * Acotar una lista de trabajo: por responsable, tipo, familia o equipos.
 *
 * Llama a las MISMAS funciones que el Calendario y el Tablero —por eso viven
 * en `lib/filtros-trabajo.ts`—. Si cada pantalla tuviera su copia, esta prueba
 * pasaria mientras una de las dos filtra distinto, que es justo el riesgo:
 * quien acota el calendario a «compresores» espera lo mismo del tablero.
 *
 *   npx tsx scripts/prueba-filtros-trabajo.ts
 */
import {
  FILTRO_VACIO, SIN_RESPONSABLE, coincide, enSeleccion, hayFiltro,
  type FiltroTrabajo,
} from "../lib/filtros-trabajo";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const con = (p: Partial<FiltroTrabajo>): FiltroTrabajo => ({ ...FILTRO_VACIO, ...p });

// Una planta chica: dos compresores, una bomba, y una orden sin equipo.
const ORDENES = [
  { id: "a", maintenanceType: "PREVENTIVE", responsableId: "luis", assetId: "cmp1", categoryId: "aire" },
  { id: "b", maintenanceType: "CORRECTIVE", responsableId: "ana", assetId: "cmp2", categoryId: "aire" },
  { id: "c", maintenanceType: "PREVENTIVE", responsableId: "luis", assetId: "bom1", categoryId: "bombeo" },
  { id: "d", maintenanceType: "CORRECTIVE", responsableId: null, assetId: null, categoryId: null },
];
const filtrar = (f: FiltroTrabajo) => ORDENES.filter((o) => coincide(f, o)).map((o) => o.id);

function main() {
  console.log("\nSIN FILTRO\n");
  revisar("sin filtro no se quita nada", JSON.stringify(filtrar(FILTRO_VACIO)) === '["a","b","c","d"]', filtrar(FILTRO_VACIO));
  revisar("y se sabe que no hay filtro puesto", hayFiltro(FILTRO_VACIO) === false);

  console.log("\nPOR FAMILIA: «solo compresores»\n");
  revisar("la familia deja solo sus equipos",
    JSON.stringify(filtrar(con({ familia: "aire" }))) === '["a","b"]', filtrar(con({ familia: "aire" })));
  // La orden sin equipo no puede pertenecer a una familia: no se cuela.
  revisar("una orden sin equipo no entra en ninguna familia",
    !filtrar(con({ familia: "aire" })).includes("d"), filtrar(con({ familia: "aire" })));

  console.log("\nPOR EQUIPOS CONCRETOS\n");
  revisar("solo los equipos elegidos",
    JSON.stringify(filtrar(con({ equipos: ["cmp1", "bom1"] }))) === '["a","c"]', filtrar(con({ equipos: ["cmp1", "bom1"] })));

  console.log("\nLOS EQUIPOS MANDAN SOBRE LA FAMILIA\n");
  // Si alguien escogio una bomba concreta, la familia «aire» no se la quita:
  // al reves, el filtro pareceria roto —elegi un equipo y no aparece—.
  revisar("elegir un equipo de otra familia no lo esconde",
    JSON.stringify(filtrar(con({ familia: "aire", equipos: ["bom1"] }))) === '["c"]',
    filtrar(con({ familia: "aire", equipos: ["bom1"] })));
  revisar("y enSeleccion dice lo mismo por su cuenta",
    enSeleccion(con({ familia: "aire", equipos: ["bom1"] }), "bom1", "bombeo") === true);

  console.log("\nPOR RESPONSABLE\n");
  revisar("solo lo de esa persona",
    JSON.stringify(filtrar(con({ tecnico: "luis" }))) === '["a","c"]', filtrar(con({ tecnico: "luis" })));
  revisar("«sin responsable» trae las que no tienen a nadie",
    JSON.stringify(filtrar(con({ tecnico: SIN_RESPONSABLE }))) === '["d"]', filtrar(con({ tecnico: SIN_RESPONSABLE })));
  revisar("y NO trae las asignadas",
    !filtrar(con({ tecnico: SIN_RESPONSABLE })).some((id) => ["a", "b", "c"].includes(id)));

  console.log("\nPOR TIPO\n");
  revisar("solo ese tipo de mantenimiento",
    JSON.stringify(filtrar(con({ tipo: "PREVENTIVE" }))) === '["a","c"]', filtrar(con({ tipo: "PREVENTIVE" })));

  console.log("\nVARIOS A LA VEZ: SE SUMAN, NO SE PISAN\n");
  revisar("familia y tipo juntos",
    JSON.stringify(filtrar(con({ familia: "aire", tipo: "CORRECTIVE" }))) === '["b"]',
    filtrar(con({ familia: "aire", tipo: "CORRECTIVE" })));
  revisar("familia, tipo y responsable juntos",
    JSON.stringify(filtrar(con({ familia: "aire", tipo: "PREVENTIVE", tecnico: "luis" }))) === '["a"]',
    filtrar(con({ familia: "aire", tipo: "PREVENTIVE", tecnico: "luis" })));
  revisar("una combinación sin resultados devuelve vacío, no todo",
    JSON.stringify(filtrar(con({ familia: "bombeo", tecnico: "ana" }))) === "[]",
    filtrar(con({ familia: "bombeo", tecnico: "ana" })));

  console.log("\nSE SABE CUANDO HAY FILTRO\n");
  for (const [que, f] of [
    ["responsable", con({ tecnico: "luis" })],
    ["tipo", con({ tipo: "PREVENTIVE" })],
    ["familia", con({ familia: "aire" })],
    ["equipos", con({ equipos: ["cmp1"] })],
  ] as Array<[string, FiltroTrabajo]>) {
    revisar(`con ${que} puesto, hay filtro`, hayFiltro(f) === true);
  }

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main();
