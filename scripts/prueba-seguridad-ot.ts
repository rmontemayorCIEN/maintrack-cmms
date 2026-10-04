/**
 * La confirmacion de haber leido el procedimiento y la seguridad.
 *
 * Lo que de verdad vigila: que la confirmacion NO sobreviva a un cambio del
 * texto. Sin eso bastaria confirmar y editar despues para que el registro
 * siguiera diciendo «leido», y un registro que no aguanta esa pregunta no
 * sirve para nada —que es justo lo contrario de lo que se busca aqui—.
 *
 *   npx tsx scripts/prueba-seguridad-ot.ts
 */
import { estadoDeSeguridad, huellaDeSeguridad, tieneSeguridad } from "../lib/seguridad-ot";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const AYER = new Date(Date.now() - 86_400_000);
const LOTO = "Bloquear y etiquetar (LOTO) el interruptor del motor y verificar ausencia de tensión.";

function main() {
  console.log("\n1. Cuándo hay algo que confirmar\n");
  revisar("sin procedimiento ni seguridad, no hay nada que leer",
    estadoDeSeguridad({}).estado === "SIN_TEXTO");
  revisar("con solo procedimiento, sí lo hay", tieneSeguridad({ procedure: "Pasos..." }));
  revisar("con solo indicaciones de seguridad, también", tieneSeguridad({ safetyNotes: LOTO }));
  revisar("un texto de puros espacios no cuenta como texto",
    !tieneSeguridad({ procedure: "   \n  ", safetyNotes: "" }));

  console.log("\n2. El ciclo normal\n");
  const wo = { procedure: "Pasos del trabajo", safetyNotes: LOTO };
  revisar("con texto y sin confirmar, está sin confirmar",
    estadoDeSeguridad(wo).estado === "SIN_CONFIRMAR");
  const confirmada = {
    ...wo,
    seguridadLeidaEl: AYER,
    seguridadLeidaHuella: huellaDeSeguridad(wo),
    seguridadLeidaPor: { name: "Miguel Aguirre" },
  };
  const e = estadoDeSeguridad(confirmada);
  revisar("confirmada, queda confirmada", e.estado === "CONFIRMADO", e);
  revisar("y se sabe quién y cuándo",
    e.estado === "CONFIRMADO" && e.porQuien === "Miguel Aguirre" && e.cuando === AYER);

  console.log("\n3. LO QUE IMPORTA: la confirmación no sobrevive a un cambio\n");
  // Alguien edita la seguridad DESPUÉS de que el técnico la confirmó: lo que
  // leyó ya no es lo que la orden dice hoy.
  const editada = { ...confirmada, safetyNotes: `${LOTO} Además, purgar la línea de vapor antes de abrir.` };
  const d = estadoDeSeguridad(editada);
  revisar("si el texto cambia después, la confirmación deja de valer",
    d.estado === "CAMBIO_DESPUES", d.estado);
  revisar("pero NO se pierde quién había confirmado ni cuándo",
    d.estado === "CAMBIO_DESPUES" && d.porQuien === "Miguel Aguirre" && d.cuando === AYER);
  // También si se cambia el procedimiento, no solo la seguridad.
  revisar("lo mismo si lo que cambia es el procedimiento",
    estadoDeSeguridad({ ...confirmada, procedure: "Otros pasos" }).estado === "CAMBIO_DESPUES");

  console.log("\n4. Lo que NO debe contar como cambio\n");
  // Un salto de línea de más no es contenido distinto: marcarlo obligaría a
  // reconfirmar por nada y la gente dejaría de hacer caso al aviso.
  revisar("un espacio o salto de línea de más no invalida la confirmación",
    estadoDeSeguridad({
      ...confirmada,
      procedure: "Pasos   del\n\ntrabajo",
      safetyNotes: `  ${LOTO}  `,
    }).estado === "CONFIRMADO");
  revisar("dos textos distintos dan huellas distintas",
    huellaDeSeguridad({ procedure: "A", safetyNotes: "B" }) !== huellaDeSeguridad({ procedure: "AB", safetyNotes: "" }));
  revisar("el mismo texto da siempre la misma huella",
    huellaDeSeguridad(wo) === huellaDeSeguridad({ ...wo }));

  console.log(fallos ? `\n${fallos} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallos ? 1 : 0;
}

main();
