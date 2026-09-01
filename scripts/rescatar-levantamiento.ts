/**
 * Reacomoda los activos creados por un levantamiento asistido.
 *
 * Repara tres cosas que la ruta de aplicacion dejaba mal:
 *   1. El activo nacia sin ubicacion aunque la IA si la habia deducido. El
 *      dato sigue guardado en la propuesta, asi que se recupera sin volver a
 *      llamar al modelo.
 *   2. El area terminaba metida dentro del nombre. Una vez que la ubicacion
 *      tiene su lugar, ese parentesis sobra.
 *   3. Las categorias nuevas quedaron con el codigo de nombre (CLIM en vez de
 *      Climatizacion). Se renombran con el sistema al que pertenecen.
 *
 * Por omision NO escribe: muestra lo que haria. Con --aplicar, ejecuta.
 *
 *   npx tsx scripts/rescatar-levantamiento.ts "Casa Montemayor"
 *   npx tsx scripts/rescatar-levantamiento.ts "Casa Montemayor" --aplicar
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const buscado = process.argv[2] ?? "Casa Montemayor";
const aplicar = process.argv.includes("--aplicar");

const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Quita el parentesis final del nombre cuando repite el area. */
function limpiarNombre(nombre: string, ubicacion: string | null) {
  let limpio = nombre.replace(/\s*\(([^()]*)\)\s*(\d+)?\s*$/, (todo, dentro, num) => {
    if (!ubicacion) return todo;
    const d = normalizar(dentro);
    const u = normalizar(ubicacion);
    // Solo se quita si el parentesis habla del mismo lugar, no si trae una
    // capacidad o una medida que si distingue al equipo.
    const parecido = d === u || d.includes(u) || u.includes(d) || /recamar|sala|comedor|sotano|azotea|cocina|jardin|alberca|cochera|patio|cuarto|estancia|nivel|planta/.test(d);
    return parecido ? (num ? ` ${num}` : "") : todo;
  });
  return limpio.replace(/\s+/g, " ").trim();
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: { contains: buscado } } });
  if (!org) throw new Error(`No existe organizacion que contenga "${buscado}"`);
  const orgId = org.id;

  console.log(`\n${org.name}  —  ${aplicar ? "APLICANDO CAMBIOS" : "SIMULACION (no escribe nada)"}\n`);

  const intakes = await prisma.assetIntake.findMany({
    where: { organizationId: orgId },
    include: { propuestas: true },
  });
  const propuestas = intakes.flatMap((i) => i.propuestas).filter((p) => p.codigoCreado);
  if (!propuestas.length) throw new Error("No hay propuestas aplicadas que rescatar.");

  const activos = await prisma.asset.findMany({
    where: { organizationId: orgId },
    include: { category: true },
  });
  const porCodigo = new Map(activos.map((a) => [a.code, a]));

  const sitios = await prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const siteId = sitios[0]?.id;
  if (!siteId) throw new Error("La organizacion no tiene sitios.");

  const ubicaciones = new Map(
    (await prisma.location.findMany({ where: { organizationId: orgId, siteId }, select: { id: true, name: true } }))
      .map((l) => [normalizar(l.name), l.id] as const),
  );
  const codigosUsados = new Set(
    (await prisma.location.findMany({ where: { organizationId: orgId, siteId }, select: { code: true } }))
      .map((l) => l.code.toUpperCase()),
  );

  let asignados = 0, renombrados = 0, categoriasArregladas = 0;
  const sinUbicacion: { code: string; nombre: string; propuesta: string; motivo: string }[] = [];

  /**
   * Empareja la ubicacion que dedujo la IA contra las que ya existen.
   *
   * NO crea ubicaciones. Las que propone el modelo son descripciones
   * compuestas —"Planta baja / planta alta / sotano"— y el usuario ya capturo
   * un catalogo propio con los cuartos reales y sus nombres de familia. Crear
   * las del modelo al lado de las suyas ensucia el catalogo sin agregar nada.
   *
   * Solo asigna cuando hay UNA sola candidata. Si la propuesta abarca varias
   * areas —tres camaras repartidas entre cochera, acceso y jardin— cualquier
   * eleccion seria una invencion, y una ubicacion incorrecta es peor que
   * ninguna: manda al tecnico al cuarto equivocado.
   */
  function emparejar(propuesta: string): { id: string | null; motivo: string } {
    const p = normalizar(propuesta);
    const candidatas = [...ubicaciones.entries()].filter(([nombre]) => {
      // Se compara por las palabras con peso, ignorando las de relleno.
      const palabras = nombre.split(" ").filter((w) => w.length > 3 && !["para", "del", "los", "las"].includes(w));
      return palabras.length > 0 && palabras.every((w) => p.includes(w));
    });
    if (candidatas.length === 1) return { id: candidatas[0][1], motivo: "" };
    if (candidatas.length > 1) {
      return { id: null, motivo: `abarca ${candidatas.length} areas: ${candidatas.map(([n]) => n).join(", ")}` };
    }
    return { id: null, motivo: "no hay una ubicacion capturada que corresponda" };
  }

  // ── 2. Activos: ubicacion y nombre ─────────────────────────────────────
  console.log("");
  for (const p of propuestas) {
    const codigos = (p.codigoCreado ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    for (const code of codigos) {
      const a = porCodigo.get(code);
      if (!a) continue;

      // Una propuesta con varios equipos viene repartida entre areas —tres
      // camaras en cochera, acceso y jardin— y el catalogo guarda una sola
      // cadena para todas. Mandarlas juntas a un solo cuarto acierta en una y
      // miente en las demas, asi que se dejan para que las asigne una persona.
      const match =
        p.cantidad > 1
          ? { id: null, motivo: `son ${p.cantidad} repartidos entre varias areas` }
          : p.ubicacion
            ? emparejar(p.ubicacion)
            : { id: null, motivo: "la IA no dedujo area" };
      const locId = match.id;
      const nombreLimpio = limpiarNombre(a.name, p.ubicacion ?? null);

      if (!locId && !a.locationId) {
        sinUbicacion.push({ code, nombre: nombreLimpio || a.name, propuesta: p.ubicacion ?? "-", motivo: match.motivo });
      }

      const cambiaUb = Boolean(locId) && a.locationId !== locId;
      const cambiaNom = nombreLimpio && nombreLimpio !== a.name;
      if (!cambiaUb && !cambiaNom) continue;

      const detalle = [
        cambiaUb ? `→ ${p.ubicacion}` : null,
        cambiaNom ? `"${nombreLimpio}"` : null,
      ].filter(Boolean).join("  ");
      console.log(`  ~ ${code.padEnd(10)} ${a.name.slice(0, 44).padEnd(45)} ${detalle}`);

      if (cambiaUb) asignados++;
      if (cambiaNom) renombrados++;
      if (aplicar) {
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            ...(cambiaUb ? { locationId: locId } : {}),
            ...(cambiaNom ? { name: nombreLimpio } : {}),
          },
        });
      }
    }
  }

  // ── 3. Categorias que quedaron con el codigo de nombre ─────────────────
  console.log("");
  const sistemaPorCategoria = new Map<string, string>();
  for (const p of propuestas) {
    const cat = p.categoria?.toUpperCase();
    if (cat && p.sistema && !sistemaPorCategoria.has(cat)) sistemaPorCategoria.set(cat, p.sistema.trim());
  }
  const categorias = await prisma.assetCategory.findMany({ where: { organizationId: orgId } });
  for (const c of categorias) {
    if (normalizar(c.name) !== normalizar(c.code)) continue;
    const nombre = sistemaPorCategoria.get(c.code.toUpperCase());
    if (!nombre || normalizar(nombre) === normalizar(c.code)) continue;
    console.log(`  ~ categoria  ${c.code.padEnd(8)} "${c.name}"  →  "${nombre}"`);
    categoriasArregladas++;
    if (aplicar) await prisma.assetCategory.update({ where: { id: c.id }, data: { name: nombre.slice(0, 60) } });
  }

  if (sinUbicacion.length) {
    console.log(`\nSIN UBICACION — los asigna usted, nadie mas sabe cual es cual (${sinUbicacion.length})`);
    console.log(`  ${"CODIGO".padEnd(10)} ${"ACTIVO".padEnd(35)} ${"AREA QUE DEDUJO LA IA".padEnd(41)} POR QUE NO SE ASIGNO SOLO`);
    for (const u of sinUbicacion) {
      console.log(`  ${u.code.padEnd(10)} ${u.nombre.slice(0, 34).padEnd(35)} ${u.propuesta.slice(0, 40).padEnd(41)} ${u.motivo}`);
    }
  }

  console.log(`\n${"─".repeat(56)}`);
  console.log(`  activos con ubicacion asignada ... ${asignados}`);
  console.log(`  activos pendientes de ubicar ..... ${sinUbicacion.length}`);
  console.log(`  activos renombrados ...... ${renombrados}`);
  console.log(`  categorias renombradas ... ${categoriasArregladas}`);
  console.log(`${"─".repeat(56)}`);
  console.log(aplicar ? "  Cambios aplicados.\n" : "  Nada se escribio. Repita con --aplicar.\n");
}

main()
  .catch((e) => { console.error("\nERROR:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
