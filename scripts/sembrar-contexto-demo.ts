/**
 * Llena el contexto del negocio de la cuenta de demostracion.
 *
 * Los textos se escribieron para que ENCAJEN con los datos que esa cuenta ya
 * tiene: la grua es la restriccion declarada y tambien la que mas paros
 * acumula; la queja de refacciones de urgencia corresponde con el backlog
 * trabado por falta de material; y la meta del 60% planeado se mide contra el
 * 64 contra 155 que hoy registra.
 *
 * Un contexto que contradice los datos ensena lo contrario de lo que se quiere
 * demostrar.
 *
 *   ./scripts/con-produccion.sh scripts/sembrar-contexto-demo.ts
 */
import { prisma } from "../lib/db";

const CONTEXTO = {
  queProduce:
    "Piezas maquinadas de acero al carbón e inoxidable —bridas, flechas y bujes— para la industria " +
    "automotriz y de válvulas. Tres clientes concentran cerca del 70% del volumen y todos penalizan " +
    "la entrega tardía; con el más grande la penalización es del 2% del pedido por cada día de retraso.",
  comoOpera:
    "Dos turnos de lunes a viernes, de 7 a 15 y de 15 a 23 horas, y medio turno el sábado hasta la " +
    "1 de la tarde. El domingo no se produce: es la única ventana buena para mantenimiento mayor. " +
    "De septiembre a diciembre es la temporada alta y ahí no se puede parar nada que no esté programado.",
  noPuedeParar:
    "La grúa viajera de 10 toneladas. Sin ella no se mueve material entre estaciones y se detiene " +
    "toda la nave, aunque las máquinas estén trabajando bien; no hay respaldo ni forma de maniobrar " +
    "con montacargas dentro de la nave. Después de la grúa, el compresor: de él dependen los " +
    "sujetadores neumáticos de los cuatro centros de maquinado, y cuando cae el aire se paran todos " +
    "al mismo tiempo.",
  dueleHoy:
    "Los paros no programados nos están comiendo la entrega. La grúa es la que más nos ha detenido " +
    "este trimestre y no acabamos de entender por qué: se ha atendido varias veces y sigue fallando. " +
    "También gastamos de más en refacciones de urgencia, porque cuando algo se descompone casi nunca " +
    "hay en almacén y terminamos comprando al doble con envío express.",
  objetivoDelAno:
    "Bajar los paros no programados a la mitad y llegar a que cuando menos el 60% del tiempo de paro " +
    "sea planeado. Queremos certificarnos en ISO 9001 antes de que termine el año, y para eso hace " +
    "falta historial de mantenimiento documentado, no solo hecho.",
};

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: "Acero Industrial del Norte (Demo)" },
    select: { id: true, name: true, tipoInstalacion: true, industry: true, queProduce: true },
  });
  if (!org) {
    console.error("\n  No se encontró la cuenta de demostración. No se hizo nada.\n");
    process.exit(1);
  }

  console.log(`\n  Cuenta: ${org.name}`);
  console.log(`  Giro: ${org.industry ?? "—"} · Instalación: ${org.tipoInstalacion ?? "—"}`);
  console.log(`  Contexto previo: ${org.queProduce ? "TENÍA (se reemplaza)" : "vacío"}\n`);

  await prisma.organization.update({
    where: { id: org.id },
    data: { ...CONTEXTO, contextoAt: new Date() },
  });

  for (const [clave, texto] of Object.entries(CONTEXTO)) {
    console.log(`  ${clave}`);
    console.log(`    ${texto.slice(0, 110)}…\n`);
  }
  console.log("  Listo. La IA de esa cuenta ya lo toma en cuenta.\n");
}

main().finally(() => prisma.$disconnect());
