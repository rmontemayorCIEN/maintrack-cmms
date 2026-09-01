/**
 * Crea la primera organizacion real y su usuario propietario en produccion.
 * A diferencia de prisma/seed.ts, no carga la planta de demostracion: deja la
 * instancia limpia y lista para capturar los activos verdaderos.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/bootstrap.ts \
 *     --empresa "Acero Industrial del Norte" \
 *     --nombre  "Rafael Montemayor" \
 *     --correo  "rafael@empresa.mx" \
 *     --clave   "una-contrasena-larga"
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function slugify(valor: string) {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const empresa = arg("empresa");
  const nombre = arg("nombre");
  const correo = arg("correo")?.toLowerCase().trim();
  const clave = arg("clave");

  if (!empresa || !nombre || !correo || !clave) {
    console.error(
      "Faltan datos. Uso:\n" +
        '  npx tsx scripts/bootstrap.ts --empresa "Mi Empresa" --nombre "Su Nombre" ' +
        '--correo "usted@empresa.mx" --clave "contrasena-larga"',
    );
    process.exit(1);
  }
  if (clave.length < 8) {
    console.error("La contrasena debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const existente = await prisma.user.findUnique({ where: { email: correo } });
  if (existente) {
    console.error(`El correo ${correo} ya esta registrado. No se hizo ningun cambio.`);
    process.exit(1);
  }

  let slug = slugify(empresa);
  let intento = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${slugify(empresa)}-${intento++}`;
  }

  const org = await prisma.organization.create({
    data: {
      name: empresa,
      slug,
      plan: "PROFESSIONAL",
      status: "ACTIVE",
      currency: "MXN",
      timezone: "America/Monterrey",
      // Catalogos minimos para que la instancia sea usable desde el primer dia.
      sites: { create: { name: "Planta principal", code: "P01", country: "Mexico" } },
      assetCategories: {
        create: [
          { name: "Equipo de proceso", code: "PROC" },
          { name: "Equipo electrico", code: "ELEC" },
          { name: "Equipo de transporte", code: "TRAN" },
          { name: "Instalaciones", code: "INST" },
        ],
      },
      failureCodes: {
        create: [
          { code: "MEC-01", description: "Desgaste mecanico", category: "MECANICO" },
          { code: "MEC-02", description: "Desalineacion", category: "MECANICO" },
          { code: "LUB-01", description: "Lubricacion deficiente", category: "MECANICO" },
          { code: "ELE-01", description: "Falla electrica", category: "ELECTRICO" },
          { code: "ELE-02", description: "Sobrecalentamiento", category: "ELECTRICO" },
          { code: "HID-01", description: "Fuga hidraulica", category: "HIDRAULICO" },
          { code: "OPE-01", description: "Error de operacion", category: "OPERACION" },
        ],
      },
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: correo,
      name: nombre,
      passwordHash: await bcrypt.hash(clave, 10),
      role: "OWNER",
      jobTitle: "Direccion",
    },
  });

  console.log("");
  console.log(`✓ Organizacion creada: ${empresa}`);
  console.log(`✓ Propietario: ${correo}`);
  console.log("✓ Catalogos base: 1 sitio, 4 categorias, 7 codigos de falla");
  console.log("");
  console.log("Ya puede entrar a la aplicacion y dar de alta usuarios desde Configuracion.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
