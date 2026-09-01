/**
 * Carga las listas estandar: familias de refaccion, unidades de medida,
 * especialidades del personal y servicios que suelen subcontratarse.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/catalogos-estandar.ts
 *   ... --org "Nombre de la empresa"     (por omision: todas)
 *
 * Es aditivo e idempotente: no toca lo que ya exista con el mismo codigo, no
 * borra nada y se puede volver a correr sin efecto. Lo que no se use se puede
 * eliminar despues desde la pantalla de Catalogos.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FAMILIAS: Array<[string, string]> = [
  ["RODAMIENTOS", "Rodamientos y baleros"],
  ["SELLOS", "Sellos y retenes"],
  ["FILTROS", "Filtros"],
  ["LUBRICANTES", "Lubricantes y grasas"],
  ["BANDAS", "Bandas y cadenas"],
  ["ELECTRICO", "Material electrico"],
  ["MOTORES", "Motores y reductores"],
  ["NEUMATICO", "Componentes neumaticos"],
  ["HIDRAULICO", "Componentes hidraulicos"],
  ["INSTRUMENTACION", "Instrumentacion y sensores"],
  ["TORNILLERIA", "Tornilleria y sujecion"],
  ["TUBERIA", "Tuberia y conexiones"],
  ["CONSUMIBLES", "Consumibles de taller"],
  ["SEGURIDAD", "Equipo de proteccion personal"],
  ["OTRO", "Otros"],
];

const UNIDADES: Array<[string, string]> = [
  ["pza", "Pieza"],
  ["jgo", "Juego"],
  ["par", "Par"],
  ["kit", "Kit"],
  ["m", "Metro"],
  ["m2", "Metro cuadrado"],
  ["kg", "Kilogramo"],
  ["g", "Gramo"],
  ["lt", "Litro"],
  ["ml", "Mililitro"],
  ["gal", "Galon"],
  ["caja", "Caja"],
  ["cubeta", "Cubeta"],
  ["bote", "Bote"],
  ["rollo", "Rollo"],
  ["tramo", "Tramo"],
];

/**
 * Especialidades con tarifa en cero a proposito: la hora-hombre la pone cada
 * empresa desde Catalogos. Un numero inventado se cuela a los costos sin que
 * nadie lo note.
 */
const ESPECIALIDADES: Array<[string, string]> = [
  ["MEC", "Mecanico"],
  ["ELE", "Electricista"],
  ["INST", "Instrumentista"],
  ["SOLD", "Soldador"],
  ["HID", "Hidraulico / neumatico"],
  ["REF", "Refrigeracion y aire acondicionado"],
  ["AUT", "Automatizacion y control"],
  ["GRAL", "Auxiliar de mantenimiento"],
  ["PRED", "Analista predictivo"],
];

/** Servicios tipicos de subcontratacion, sin costo hasta que se cotice. */
const SERVICIOS: Array<[string, string, string]> = [
  ["SRV-REB", "Rebobinado de motor electrico", "servicio"],
  ["SRV-BAL", "Balanceo dinamico de rotor", "servicio"],
  ["SRV-ALI", "Alineacion laser", "servicio"],
  ["SRV-TERM", "Termografia infrarroja", "servicio"],
  ["SRV-VIB", "Analisis de vibraciones", "servicio"],
  ["SRV-ACE", "Analisis de aceite de laboratorio", "muestra"],
  ["SRV-CAL", "Calibracion certificada de instrumentos", "instrumento"],
  ["SRV-GRUA", "Maniobra con grua o montacargas", "jornada"],
  ["SRV-MAQ", "Maquinado y rectificado en taller externo", "servicio"],
  ["SRV-LIMP", "Limpieza industrial especializada", "jornada"],
  ["SRV-OBRA", "Obra civil y estructural", "jornada"],
  ["SRV-EXT", "Servicio de fabricante en sitio", "visita"],
];

function arg(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const filtro = arg("org");
  const orgs = await prisma.organization.findMany({
    where: filtro ? { name: { contains: filtro } } : {},
    select: { id: true, name: true },
  });

  if (!orgs.length) {
    console.error(filtro ? `No hay organizacion que coincida con "${filtro}".` : "No hay organizaciones.");
    process.exit(1);
  }

  for (const org of orgs) {
    let nuevasFamilias = 0;
    let nuevasUnidades = 0;

    for (const [code, name] of FAMILIAS) {
      const existe = await prisma.partCategory.findUnique({
        where: { organizationId_code: { organizationId: org.id, code } },
        select: { id: true },
      });
      if (!existe) {
        await prisma.partCategory.create({ data: { organizationId: org.id, code, name } });
        nuevasFamilias += 1;
      }
    }

    for (const [code, name] of UNIDADES) {
      const existe = await prisma.partUnit.findUnique({
        where: { organizationId_code: { organizationId: org.id, code } },
        select: { id: true },
      });
      if (!existe) {
        await prisma.partUnit.create({ data: { organizationId: org.id, code, name } });
        nuevasUnidades += 1;
      }
    }

    let nuevasEspecialidades = 0;
    let nuevosServicios = 0;

    for (const [code, name] of ESPECIALIDADES) {
      const existe = await prisma.specialty.findUnique({
        where: { organizationId_code: { organizationId: org.id, code } },
        select: { id: true },
      });
      if (!existe) {
        await prisma.specialty.create({ data: { organizationId: org.id, code, name } });
        nuevasEspecialidades += 1;
      }
    }

    for (const [code, name, unit] of SERVICIOS) {
      const existe = await prisma.externalService.findUnique({
        where: { organizationId_code: { organizationId: org.id, code } },
        select: { id: true },
      });
      if (!existe) {
        await prisma.externalService.create({ data: { organizationId: org.id, code, name, unit } });
        nuevosServicios += 1;
      }
    }

    const totalF = await prisma.partCategory.count({ where: { organizationId: org.id } });
    const totalU = await prisma.partUnit.count({ where: { organizationId: org.id } });
    const totalE = await prisma.specialty.count({ where: { organizationId: org.id } });
    const totalS = await prisma.externalService.count({ where: { organizationId: org.id } });

    console.log(`${org.name}`);
    console.log(`  familias:       +${nuevasFamilias} nuevas  (total ${totalF})`);
    console.log(`  unidades:       +${nuevasUnidades} nuevas  (total ${totalU})`);
    console.log(`  especialidades: +${nuevasEspecialidades} nuevas  (total ${totalE})`);
    console.log(`  servicios ext.: +${nuevosServicios} nuevos  (total ${totalS})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
