/**
 * Firma una sesion valida para la base LOCAL de desarrollo.
 *
 * Existe para poder abrir el sistema en local sin pasar por el formulario de
 * acceso: usa la misma llave del .env de desarrollo. No sirve para produccion
 * —esa llave vive en Secret Manager y aqui no se toca— ni pretende sustituir
 * al login: es un utensilio para tomar capturas de pantalla y revisar
 * pantallas durante el desarrollo.
 */
import { SignJWT } from "jose";
import { prisma } from "../lib/db";

async function main() {
  const correo = process.argv[2] ?? "director@demo.maintrack.mx";
  const user = await prisma.user.findFirst({
    where: { email: correo },
    select: { id: true, organizationId: true, email: true, name: true, role: true, isSuperAdmin: true },
  });
  if (!user) throw new Error(`No existe ${correo} en la base local`);

  const llave = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");
  if (!process.env.AUTH_SECRET) throw new Error("Falta AUTH_SECRET en el .env local");

  const token = await new SignJWT({
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(llave);

  console.log(token);
}
main().finally(() => prisma.$disconnect());
