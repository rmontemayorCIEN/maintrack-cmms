/**
 * Genera el par de llaves VAPID que firma los avisos al celular.
 *
 *   npx tsx scripts/generar-llaves-avisos.ts
 *
 * LA LLAVE PRIVADA NO SE IMPRIME. Nunca sale por la terminal, ni siquiera
 * parcialmente. Se escribe en un archivo que el repositorio ignora y de ahi se
 * copia a Secret Manager por la consola web de Google Cloud.
 *
 * Ese es el motivo de que este script exista en vez de una linea de comando:
 * `web-push generate-vapid-keys` imprime la privada en pantalla, y la pantalla
 * queda en el historial de la terminal, en el buffer del emulador y en
 * cualquier captura. Ya se quemaron dos llaves de otro servicio asi.
 *
 * Se corre UNA sola vez. Regenerarlas invalida todas las suscripciones que ya
 * existen: cada telefono tendria que volver a activarse a mano.
 */
import { existsSync, appendFileSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";

const RAIZ = process.cwd();
const ARCHIVO = join(RAIZ, ".llaves-avisos.txt");
const ENV = join(RAIZ, ".env");

function main() {
  if (existsSync(ARCHIVO)) {
    console.log("\n  Ya existe .llaves-avisos.txt. No se toca.");
    console.log("  Regenerarlas obligaria a cada persona a volver a activar su telefono.");
    console.log("  Si de verdad quiere unas nuevas, borre ese archivo primero.\n");
    return;
  }

  const llaves = webpush.generateVAPIDKeys();

  const contenido = [
    "LLAVES DE AVISOS AL CELULAR — MainTrack",
    `Generadas el ${new Date().toLocaleString("es-MX")}`,
    "",
    "La privada es un secreto. No la pegue en un chat, ni en un correo, ni la",
    "escriba en la terminal. Copiela de aqui directo al campo de Secret Manager",
    "en la consola web de Google Cloud y despues borre este archivo.",
    "",
    "── Para Secret Manager (produccion) ──",
    "",
    "  Nombre del secreto:  vapid-private-key",
    `  Valor:               ${llaves.privateKey}`,
    "",
    "  Nombre del secreto:  vapid-public-key",
    `  Valor:               ${llaves.publicKey}`,
    "",
    "── Variables que espera la aplicacion ──",
    "",
    "  VAPID_PUBLIC_KEY   (la publica; puede ir en texto plano, la ve el navegador)",
    "  VAPID_PRIVATE_KEY  (la privada; SIEMPRE desde Secret Manager)",
    "  VAPID_SUBJECT      (mailto: de contacto, p. ej. mailto:soporte@maintrack.mx)",
    "",
    "Cuando ya esten cargadas en la nube, borre este archivo:",
    "  rm .llaves-avisos.txt",
    "",
  ].join("\n");

  writeFileSync(ARCHIVO, contenido, { mode: 0o600 });
  chmodSync(ARCHIVO, 0o600);

  /**
   * En desarrollo se agregan al .env para poder probar de inmediato.
   *
   * Solo se AGREGA al final y solo si no estaban: reescribir el archivo
   * pondria en riesgo el resto de las credenciales que ya vive ahi.
   */
  let enDesarrollo = false;
  if (existsSync(ENV)) {
    const env = readFileSync(ENV, "utf8");
    if (!env.includes("VAPID_PRIVATE_KEY")) {
      appendFileSync(
        ENV,
        [
          "",
          "# Avisos al celular. La privada NO se sube a ningun lado:",
          "# en produccion vive en Secret Manager.",
          `VAPID_PUBLIC_KEY="${llaves.publicKey}"`,
          `VAPID_PRIVATE_KEY="${llaves.privateKey}"`,
          'VAPID_SUBJECT="mailto:soporte@maintrack.mx"',
          "",
        ].join("\n"),
      );
      enDesarrollo = true;
    }
  }

  console.log("\n  Llaves generadas.\n");
  // La publica no es secreta: la recibe cualquier navegador que se suscriba.
  console.log(`  Publica:  ${llaves.publicKey}`);
  console.log("  Privada:  (no se imprime a proposito)\n");
  console.log(`  Escritas en:  ${ARCHIVO}`);
  if (enDesarrollo) console.log("  Agregadas a .env para desarrollo.");
  console.log("");
  console.log("  Siguiente paso, en la consola web de Google Cloud:");
  console.log("    1. Secret Manager → Crear secreto → vapid-private-key");
  console.log("    2. Pegue el valor del archivo (no lo escriba en la terminal)");
  console.log("    3. Repita con vapid-public-key");
  console.log("    4. Cloud Run → maintrack-cmms → Editar → Variables y secretos");
  console.log("    5. Exponga los dos como VAPID_PRIVATE_KEY y VAPID_PUBLIC_KEY");
  console.log("    6. Agregue VAPID_SUBJECT como variable normal");
  console.log(`    7. Ya que esten arriba:  rm ${ARCHIVO}`);
  console.log("");
}

main();
