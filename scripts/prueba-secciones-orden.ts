/**
 * Que secciones de la orden nacen desplegadas.
 *
 * Llama a la MISMA funcion que usa la pantalla (`lib/secciones-orden.ts`).
 * Lo que mas vigila es la regla que manda sobre todas: una seccion con algo
 * pendiente nace abierta pase lo que pase. Esconder lo que falta para cerrar
 * es el defecto que este proyecto ya pago caro.
 *
 *   npx tsx scripts/prueba-secciones-orden.ts
 */
import { naceAbierta, type ClaveSeccion } from "../lib/secciones-orden";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const TODAS: ClaveSeccion[] = ["actividades", "seguridad", "tiempo", "materiales", "lecturas", "evidencias", "bitacora", "resultado"];
const abiertasEn = (estado: string) => TODAS.filter((s) => naceAbierta(s, estado));

function main() {
  console.log("\nLO PENDIENTE MANDA SOBRE TODO\n");
  for (const estado of ["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"]) {
    revisar(`en ${estado}, una sección con algo pendiente nace abierta`,
      TODAS.every((s) => naceAbierta(s, estado, true)));
  }

  console.log("\nCADA MOMENTO MUESTRA LO SUYO\n");
  revisar("antes de empezar: qué hacer y cómo hacerlo seguro",
    abiertasEn("ASSIGNED").includes("actividades") && abiertasEn("ASSIGNED").includes("seguridad"),
    abiertasEn("ASSIGNED"));
  /*
   * Donde el técnico ESCRIBE se queda abierto mientras la orden vive: pedir
   * apoyo, la nota sin enviar y el horómetro viven en la bitácora y en las
   * lecturas. Se probó recogerlas y tumbó cuatro flujos del técnico en la
   * prueba de interfaz; uno hasta mandó una lectura vacía.
   */
  for (const estado of ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"]) {
    revisar(`en ${estado} la bitácora está abierta: ahí se pide apoyo y se anota`,
      abiertasEn(estado).includes("bitacora"), abiertasEn(estado));
  }
  for (const estado of ["ASSIGNED", "IN_PROGRESS"]) {
    revisar(`en ${estado} las lecturas están abiertas: ahí se captura el horómetro`,
      abiertasEn(estado).includes("lecturas"), abiertasEn(estado));
  }
  revisar("ya cerrada, la bitácora sí se recoge: no se escribe más",
    !abiertasEn("CLOSED").includes("bitacora"), abiertasEn("CLOSED"));
  revisar("a media reparación: lo que se hace, el tiempo y el material",
    abiertasEn("IN_PROGRESS").includes("tiempo") && abiertasEn("IN_PROGRESS").includes("materiales"),
    abiertasEn("IN_PROGRESS"));
  revisar("y ahí la seguridad se recoge: ya se leyó antes de empezar",
    !abiertasEn("IN_PROGRESS").includes("seguridad"), abiertasEn("IN_PROGRESS"));
  // La sección de lecturas solo existe si el equipo tiene medidores: si está,
  // hay algo que registrar y el trabajo está en curso.
  revisar("detenida: lo primero es por qué, y eso vive en la bitácora",
    abiertasEn("ON_HOLD").includes("bitacora"), abiertasEn("ON_HOLD"));
  revisar("terminada: el resultado y con qué se respalda",
    abiertasEn("COMPLETED").includes("resultado") && abiertasEn("COMPLETED").includes("evidencias"),
    abiertasEn("COMPLETED"));
  revisar("cerrada: se consulta el resultado, lo demás es historia",
    JSON.stringify(abiertasEn("CLOSED")) === '["resultado"]', abiertasEn("CLOSED"));

  console.log("\nLO QUE NO DEBE PASAR\n");
  // Una orden en proceso con el resultado desplegado invita a cerrarla sin
  // haberla hecho; una recién asignada con el tiempo abierto pide horas que
  // nadie ha trabajado.
  revisar("en proceso NO se ofrece el resultado", !abiertasEn("IN_PROGRESS").includes("resultado"));
  revisar("recién asignada NO se piden horas todavía", !abiertasEn("ASSIGNED").includes("tiempo"));
  revisar("ningún estado deja TODO recogido", 
    ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"]
      .every((e) => abiertasEn(e).length > 0));
  // Un estado nuevo que nadie agregó a la tabla no puede dejar la orden muda.
  revisar("un estado desconocido abre todo, no esconde nada",
    JSON.stringify(abiertasEn("UN_ESTADO_NUEVO")) === JSON.stringify(TODAS), abiertasEn("UN_ESTADO_NUEVO"));

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main();
