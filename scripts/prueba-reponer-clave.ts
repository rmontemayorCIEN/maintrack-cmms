/**
 * Reponer la contraseña de alguien de la empresa.
 *
 * Antes no existia: quien la olvidaba quedaba fuera para siempre. No hay
 * correo de recuperacion y la contraseña solo se definia al crear el usuario,
 * asi que la unica salida era abandonar la cuenta y perder su historial.
 *
 * Lo que se prueba es la GUARDA, porque es lo que separa una funcion util de
 * una puerta para quedarse con la empresa de otro.
 *
 *   npx tsx scripts/prueba-reponer-clave.ts
 */
import { prisma } from "../lib/db";
import { hashPassword, verifyPassword } from "../lib/auth";
import { puedeReponerClave, LARGO_MINIMO_CLAVE } from "../lib/reponer-clave";
import { logAudit } from "../lib/audit";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-clave-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const dueno = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-d@t.mx`, name: "Dueña", role: "OWNER", passwordHash: await hashPassword("delDueno2026") },
  });
  const admin = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-a@t.mx`, name: "Admin Uno", role: "ADMIN", passwordHash: await hashPassword("delAdmin2026") },
  });
  const tecnico = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-t@t.mx`, name: "Jose Trevino", role: "TECHNICIAN", passwordHash: await hashPassword("laVieja2026") },
  });

  try {
    console.log("\nLa guarda: quién puede reponerle a quién");
    revisar("el administrador puede al técnico",
      puedeReponerClave(admin, tecnico).puede);

    // Si un administrador pudiera reponerle la clave al propietario, lo dejaria
    // fuera de su propia empresa y se quedaria con la cuenta.
    const alDueno = puedeReponerClave(admin, dueno);
    revisar("NADIE puede al propietario", !alDueno.puede,
      alDueno.puede ? "SE PERMITIÓ" : alDueno.motivo);
    revisar("y responde 403, no 500", !alDueno.puede && alDueno.codigo === 403);

    // Sin pedir la anterior, quien tomara una sesion abierta se quedaria con la
    // cuenta. La propia se cambia en «Mi cuenta».
    const aSiMismo = puedeReponerClave(admin, admin);
    revisar("nadie se repone la suya por esta vía", !aSiMismo.puede,
      aSiMismo.puede ? "SE PERMITIÓ" : aSiMismo.motivo);

    // El propietario tampoco se la repone a si mismo por aqui, aunque sea dueño.
    revisar("ni el propietario a sí mismo", !puedeReponerClave(dueno, dueno).puede);

    console.log("\nLa contraseña repuesta funciona de verdad");
    const nueva = "laNueva2026!";
    await prisma.user.update({
      where: { id: tecnico.id },
      data: { passwordHash: await hashPassword(nueva) },
    });
    const recargado = await prisma.user.findUniqueOrThrow({
      where: { id: tecnico.id }, select: { passwordHash: true },
    });
    revisar("entra con la nueva", await verifyPassword(nueva, recargado.passwordHash));
    // Si la vieja siguiera sirviendo, reponer no habria servido de nada: quien
    // se quedo con la anterior seguiria entrando.
    revisar("YA NO entra con la vieja", !(await verifyPassword("laVieja2026", recargado.passwordHash)));
    revisar("no se guarda en claro", !recargado.passwordHash.includes(nueva));

    console.log("\nEl largo mínimo");
    revisar("son al menos 8 caracteres", LARGO_MINIMO_CLAVE >= 8, String(LARGO_MINIMO_CLAVE));

    console.log("\nLa bitácora dice quién, no cuál");
    await logAudit({
      organizationId: org.id, userId: admin.id,
      entity: "User", entityId: tecnico.id, action: "PASSWORD_RESET",
      summary: `${admin.name} repuso la contraseña de ${tecnico.name} (${tecnico.email})`,
    });
    const registro = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org.id, action: "PASSWORD_RESET" },
    });
    revisar("registra quién la repuso", (registro.summary ?? "").includes("Admin Uno"), registro.summary ?? "");
    revisar("y a quién", (registro.summary ?? "").includes("Jose Trevino"));
    // El dia que alguien pregunte "¿quien le dio acceso a esta cuenta?", la
    // respuesta tiene que estar aqui — y la contraseña NO.
    const todo = JSON.stringify(registro);
    revisar("NUNCA guarda la contraseña", !todo.includes(nueva) && !todo.includes("laVieja2026"), "revisado el registro completo");

    console.log("\nNo se cruza entre organizaciones");
    // La ruta busca al objetivo con organizationId: sin ese filtro, un
    // administrador podria reponerle la clave a alguien de otra empresa
    // conociendo su identificador.
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" },
    });
    const ajeno = await prisma.user.create({
      data: { organizationId: otra.id, email: `${sello}-x@t.mx`, name: "Ajeno", role: "TECHNICIAN", passwordHash: await hashPassword("suya2026") },
    });
    const encontrado = await prisma.user.findFirst({
      where: { id: ajeno.id, organizationId: org.id },
    });
    revisar("un usuario de otra empresa no se encuentra", encontrado === null);
    await prisma.organization.delete({ where: { id: otra.id } });
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
