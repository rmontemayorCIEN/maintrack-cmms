/** Prueba la deteccion de riesgo: importa mas no perder uno que exagerar. */
import { evaluarRiesgo } from "../lib/riesgo";

let fallas = 0;
function revisar(texto: string, esperado: "NINGUNO" | "ALTO") {
  const r = evaluarRiesgo(texto);
  const bien = r.nivel === esperado;
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${r.nivel.padEnd(7)} ${texto.slice(0, 58).padEnd(60)}${r.motivo ? `— ${r.motivo}` : ""}`);
}

console.log("\nDEBE MARCAR RIESGO\n");
revisar("Huele a gas en la cocina", "ALTO");
revisar("huele raro, como a huevo podrido", "ALTO");
revisar("Hay un cable pelado en el pasillo", "ALTO");
revisar("El contacto da toque cuando lo tocas", "ALTO");
revisar("Los cables quedaron expuestos tras la obra", "ALTO");
revisar("El tablero está chispeando", "ALTO");
revisar("El minisplit se calienta mucho y huele a quemado", "ALTO");
revisar("Sale humo del tablero", "ALTO");
revisar("La lampara está colgando, se va a caer", "ALTO");
revisar("Se cortó un compañero con la lámina", "ALTO");
revisar("El agua está llegando al tablero eléctrico", "ALTO");
revisar("Se está inundando el cuarto de máquinas", "ALTO");

console.log("\nNO DEBE MARCAR RIESGO\n");
revisar("El aire acondicionado no enfría", "NINGUNO");
revisar("La llave del baño gotea un poco", "NINGUNO");
revisar("La puerta rechina al abrir", "NINGUNO");
revisar("Falta cambiar el filtro del minisplit", "NINGUNO");
revisar("El elevador tarda en llegar", "NINGUNO");

console.log("\nCON Y SIN ACENTOS DEBE DAR LO MISMO\n");
revisar("Se esta inundando el cuarto de maquinas", "ALTO");
revisar("El cable esta pelado", "ALTO");
revisar("SE CORTO UN COMPAÑERO", "ALTO");
revisar("HUELE A GAS", "ALTO");

console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
process.exitCode = fallas ? 1 : 0;
