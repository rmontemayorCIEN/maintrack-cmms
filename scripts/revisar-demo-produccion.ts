/**
 * Revision de las cuentas de la empresa demostrativa.
 *
 * Nacio de un hallazgo del Bloque 8: la guia enumera ocho cuentas y en
 * produccion habia una novena, creada a mano, que contradecia lo que se le
 * ensena al cliente.
 *
 * Sin banderas solo reporta. Con `--desactivar --aplicar` deja inactivas las
 * cuentas que no vienen de la semilla: no las borra, porque una cuenta borrada
 * se lleva por delante lo que haya firmado o cerrado.
 *
 *   ./scripts/con-produccion.sh scripts/revisar-demo-produccion.ts
 *   ./scripts/con-produccion.sh scripts/revisar-demo-produccion.ts --desactivar --aplicar
 */
import { PrismaClient } from "@prisma/client";
import { PERSONAS, DEMO } from "../lib/demo-comercial";

const prisma = new PrismaClient();
const desactivar = process.argv.includes("--desactivar");
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const orgs = await prisma.organization.findMany({ where: { esDemo: true }, select: { id: true, name: true, slug: true } });
  if (!orgs.length) { console.log("No hay empresa demostrativa."); return; }

  for (const org of orgs) {
    console.log(`\n${org.name} (${org.slug})`);
    const usuarios = await prisma.user.findMany({
      where: { organizationId: org.id },
      select: { email: true, name: true, role: true, active: true, isSuperAdmin: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const esperados = new Set(PERSONAS.map((p) => `${p.clave}@${DEMO.dominio}`));
    console.log(`  cuentas: ${usuarios.length} (la guia enumera ${PERSONAS.length})`);
    for (const u of usuarios) {
      const marca = esperados.has(u.email) ? " " : "*";
      console.log(`  ${marca} ${u.email.padEnd(42)} ${u.role.padEnd(11)} ${u.active ? "activa  " : "inactiva"} ${u.isSuperAdmin ? "SUPER-ADMIN" : ""}`);
    }
    const extra = usuarios.filter((u) => !esperados.has(u.email) && u.active);
    if (extra.length) {
      console.log("  (*) no viene de la semilla: la guia solo enumera las de arriba");
      if (desactivar) {
        for (const u of extra) {
          if (!aplicar) { console.log(`  ENSAYO: se desactivaria ${u.email}`); continue; }
          await prisma.user.update({
            where: { email: u.email },
            // sessionsValidFrom corta la sesion que estuviera abierta con esa
            // cuenta; desactivar sin esto la deja entrando siete dias mas.
            data: { active: false, sessionsValidFrom: new Date() },
          });
          console.log(`  desactivada ${u.email}`);
        }
      }
    }

    // Quien mas puede entrar a la demo sin ser de ella: el operador de la plataforma.
    const superAdmins = await prisma.user.findMany({ where: { isSuperAdmin: true }, select: { email: true, organizationId: true } });
    console.log(`  super-admins en todo el sistema: ${superAdmins.length} (${superAdmins.map((s) => s.email).join(", ")})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
