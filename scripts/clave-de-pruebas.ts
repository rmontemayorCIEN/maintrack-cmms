/**
 * Define la contrasena de una cuenta en la base de PRUEBAS, la de las
 * versiones de prueba de cada propuesta.
 *
 *   ./scripts/con-pruebas.sh scripts/clave-de-pruebas.ts correo@ejemplo.mx
 *   ./scripts/con-pruebas.sh scripts/clave-de-pruebas.ts correo@ejemplo.mx --aplicar
 *
 * Existe porque la base de pruebas se siembra con claves al azar que nadie
 * guarda: a los pocos dias hay datos y nadie puede entrar a verlos, que es
 * justo lo que hace inutil una version de prueba.
 *
 * ── Por que no se usa `clave-de-desarrollo.ts`
 *
 * Ese se niega a correr contra cualquier cosa que no sea el archivo SQLite
 * local, y esta bien que asi sea. Esto es su hermano para la nube, con la
 * guarda que corresponde: solo corre si lo lanzo `con-pruebas.sh`, que es el
 * unico que apunta a `maintrack-db-pruebas`. Lanzado por `con-produccion.sh`
 * —o a mano con la cadena de produccion exportada— se detiene antes de tocar
 * nada. Cambiarle la contrasena a alguien de un cliente no puede depender de
 * que uno escriba bien el nombre del script.
 *
 * Sin `--aplicar` solo dice a quien le cambiaria la clave.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/auth";

/** La instancia que `con-pruebas.sh` exporta. Cualquier otra cosa se rechaza. */
const INSTANCIA_DE_PRUEBAS = "maintrack-db-pruebas";

/** Legible para dictarla, al azar para no ser adivinable. Igual que la demo. */
function claveLegible() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let clave = "";
  for (const b of randomBytes(10)) clave += alfabeto[b % alfabeto.length];
  return `Prueba-${clave}`;
}

async function main() {
  const correo = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  const indiceClave = process.argv.indexOf("--clave");
  const clave = indiceClave !== -1 ? process.argv[indiceClave + 1] : claveLegible();

  if (!correo || correo.startsWith("--")) {
    console.error("Uso: ./scripts/con-pruebas.sh scripts/clave-de-pruebas.ts correo@ejemplo.mx [--aplicar]");
    process.exit(1);
  }

  if (process.env.MT_INSTANCIA_SQL !== INSTANCIA_DE_PRUEBAS) {
    console.error("");
    console.error(`  ESTE SCRIPT SOLO CORRE CONTRA «${INSTANCIA_DE_PRUEBAS}».`);
    console.error("");
    console.error("  Lanzado de otra forma no sabe a que base esta apuntando, y de eso");
    console.error("  depende la contrasena de alguien que si es cliente. Correcto:");
    console.error("");
    console.error("    ./scripts/con-pruebas.sh scripts/clave-de-pruebas.ts " + correo + " --aplicar");
    console.error("");
    process.exit(1);
  }

  if (clave.length < 8) {
    console.error("La contrasena es muy corta: ocho caracteres cuando menos.");
    process.exit(1);
  }

  const usuario = await prisma.user.findUnique({
    where: { email: correo },
    select: { id: true, name: true, role: true, active: true, organization: { select: { name: true, slug: true } } },
  });
  if (!usuario) {
    console.error(`No hay ninguna cuenta con el correo «${correo}» en la base de pruebas.`);
    process.exit(1);
  }

  console.log("");
  console.log(`Cuenta  : ${usuario.name} <${correo}> (${usuario.role}${usuario.active ? "" : ", DESACTIVADA"})`);
  console.log(`Empresa : ${usuario.organization.name} (${usuario.organization.slug})`);
  console.log(`Base    : ${INSTANCIA_DE_PRUEBAS}`);
  console.log("");

  if (!aplicar) {
    console.log("  MODO ENSAYO. No se cambio nada. Para hacerlo: --aplicar");
    console.log("");
    return;
  }

  await prisma.user.update({ where: { id: usuario.id }, data: { passwordHash: await hashPassword(clave) } });

  console.log(`  Contrasena nueva: ${clave}`);
  console.log("");
  console.log("  Se imprime UNA vez y no queda guardada en ningun lado. Es una cuenta");
  console.log("  de la base de pruebas, que se usa y se tira; no es de ningun cliente.");
  console.log("");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
