/**
 * Define la contrasena de un usuario en la base LOCAL de desarrollo.
 *
 * Sirve para poder entrar a localhost y probar la aplicacion. La base de
 * desarrollo es un archivo SQLite en la maquina, con datos de mentiras: no
 * tiene nada que ver con la de produccion ni con las cuentas de los clientes.
 *
 * SE NIEGA A CORRER CONTRA CUALQUIER COSA QUE NO SEA ESE ARCHIVO LOCAL.
 * La comprobacion de abajo no es adorno: sin ella, bastaria tener exportada la
 * cadena de produccion para cambiarle la contrasena a un cliente desde aqui.
 *
 *   npx tsx scripts/clave-de-desarrollo.ts correo@ejemplo.mx "la-clave"
 */
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/auth";

async function main() {
  const url = process.env.DATABASE_URL ?? "";

  // Solo SQLite local. Cualquier cosa con host, usuario o postgres se rechaza.
  const esLocal = url.startsWith("file:") && !url.includes("://");
  if (!esLocal) {
    console.error("");
    console.error("  Este script solo corre contra la base local de desarrollo.");
    console.error("  DATABASE_URL no apunta a un archivo SQLite, asi que no se hace nada.");
    console.error("");
    console.error("  Si queria cambiar una contrasena de produccion: eso no se hace");
    console.error("  desde aqui. El usuario la cambia desde la aplicacion.");
    console.error("");
    process.exit(1);
  }

  const [correo, clave] = process.argv.slice(2);
  if (!correo || !clave) {
    console.error("Uso: npx tsx scripts/clave-de-desarrollo.ts correo@ejemplo.mx \"la-clave\"");
    process.exit(1);
  }
  if (clave.length < 8) {
    console.error("La clave debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const usuario = await prisma.user.findFirst({
    where: { email: correo },
    select: {
      id: true, name: true, role: true,
      organization: { select: { name: true, plan: true } },
    },
  });
  if (!usuario) {
    console.error(`No existe el usuario ${correo} en la base de desarrollo.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: usuario.id },
    data: { passwordHash: await hashPassword(clave), active: true },
  });

  console.log("");
  console.log(`  Listo. Ya puede entrar a http://localhost:3000`);
  console.log("");
  console.log(`  Correo:  ${correo}`);
  console.log(`  Perfil:  ${usuario.role} — ${usuario.name}`);
  console.log(`  Cuenta:  ${usuario.organization.name} [${usuario.organization.plan}]`);
  console.log("");
  console.log("  Solo sirve en su maquina. La base de produccion no se toco.");
  console.log("");
}

main().finally(() => prisma.$disconnect());
