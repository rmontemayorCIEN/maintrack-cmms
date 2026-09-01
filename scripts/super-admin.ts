/**
 * Otorga o retira el rol de operador de la plataforma.
 *
 *   npx tsx scripts/super-admin.ts --correo usted@empresa.mx
 *   npx tsx scripts/super-admin.ts --correo usted@empresa.mx --retirar
 *   npx tsx scripts/super-admin.ts --listar
 *
 * Deliberadamente NO existe pantalla para esto: quien opera la plataforma
 * puede entrar a los datos de cualquier cliente, asi que el privilegio se
 * concede desde la linea de comandos y queda fuera del alcance de la interfaz.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const tiene = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  if (tiene("listar")) {
    const ops = await prisma.user.findMany({
      where: { isSuperAdmin: true },
      select: { email: true, name: true, organization: { select: { name: true } } },
    });
    if (!ops.length) console.log("No hay operadores de plataforma.");
    for (const o of ops) console.log(`  ${o.email}  ·  ${o.name}  ·  ${o.organization.name}`);
    return;
  }

  const correo = arg("correo")?.toLowerCase().trim();
  if (!correo) {
    console.error("Uso: npx tsx scripts/super-admin.ts --correo usted@empresa.mx [--retirar]");
    process.exit(1);
  }

  const usuario = await prisma.user.findUnique({ where: { email: correo }, select: { id: true, name: true } });
  if (!usuario) {
    console.error(`No existe un usuario con el correo ${correo}.`);
    process.exit(1);
  }

  const retirar = tiene("retirar");
  await prisma.user.update({ where: { id: usuario.id }, data: { isSuperAdmin: !retirar } });

  console.log(retirar
    ? `✓ ${usuario.name} ya no es operador de la plataforma.`
    : `✓ ${usuario.name} es ahora operador de la plataforma. Vera "Empresas cliente" en el menu.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
