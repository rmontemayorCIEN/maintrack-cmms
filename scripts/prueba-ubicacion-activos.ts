/**
 * Ubicación de los activos: latitud y longitud al importar.
 *
 * Llama a las mismas funciones que la ruta de importación (`validarImportacion`,
 * `ejecutarImportacion`). Cubre el caso nuevo (coordenadas válidas se guardan),
 * el viejo (un activo sin coordenadas sigue importándose) y los que no deben
 * pasar (una sola coordenada, fuera de rango, coma como decimal).
 *
 *   npx tsx scripts/prueba-ubicacion-activos.ts
 */
import { prisma } from "../lib/db";
import { ejecutarImportacion, validarImportacion } from "../lib/importacion-motor";
import { dentroDeMexico, enlaceDePunto, errorDeParDeCoordenadas, latitudZod, longitudZod } from "../lib/geografia";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}
const csv = (filas: string[][]) => filas.map((f) => f.join(",")).join("\n");

async function main() {
  const sello = `ubi-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: `${sello}`, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });
  try {
    const admin = await prisma.user.create({
      data: { organizationId: org.id, email: `adm-${sello}@t.mx`, name: "Admin", role: "ADMIN", passwordHash: "x" },
    });
    const ctx = { organizationId: org.id, userId: admin.id, plan: "ENTERPRISE" };
    await ejecutarImportacion({ tipo: "sitios", contenido: csv([["codigo", "nombre"], ["GPE", "Guadalupe"]]), ...ctx });

    console.log("\n1. Helpers comunes");
    revisar("Monterrey está dentro de México", dentroDeMexico(25.6866, -100.3161));
    revisar("Madrid y el (0,0) no", !dentroDeMexico(40.4, -3.7) && !dentroDeMexico(0, 0));
    revisar("la latitud 91 y la longitud -181 se rechazan; lo normal pasa",
      !latitudZod.safeParse(91).success && !longitudZod.safeParse(-181).success &&
      latitudZod.safeParse("25.67").success && longitudZod.safeParse("-100.25").success);

    revisar("el par: una sola coordenada es error; las dos, o ninguna, no",
      errorDeParDeCoordenadas(25.6, null) !== null && errorDeParDeCoordenadas(null, -100.2) !== null &&
      errorDeParDeCoordenadas(25.6, -100.2) === null && errorDeParDeCoordenadas(null, undefined) === null);
    revisar("el enlace al punto lleva las coordenadas, y es nulo sin ellas",
      enlaceDePunto(25.6772, -100.2594) === "https://www.google.com/maps/search/?api=1&query=25.6772,-100.2594" && enlaceDePunto(null, null) === null);

    console.log("\n2. Caso nuevo: coordenadas válidas");
    const buenos = csv([
      ["codigo", "nombre", "sitio", "latitud", "longitud"],
      ["LUM-0001", "Luminaria LED 100 W", "GPE", "25.6772", "-100.2594"],
      ["LUM-0002", "Luminaria LED 70 W", "GPE", "25.6801", "-100.2550"],
    ]);
    const vBuenos = await validarImportacion({ tipo: "activos", contenido: buenos, ...ctx });
    revisar("validan sin errores ni avisos de ubicación",
      vBuenos.puedeImportar && vBuenos.totales.errores === 0 &&
      vBuenos.filas.every((f) => !f.advertencias.some((a) => a.columna === "latitud" || a.columna === "longitud")), vBuenos.totales);
    await ejecutarImportacion({ tipo: "activos", contenido: buenos, ...ctx });
    const a1 = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: "LUM-0001" } });
    revisar("se guardan tal cual", a1.latitud === 25.6772 && a1.longitud === -100.2594, { lat: a1.latitud, lon: a1.longitud });

    console.log("\n3. Caso viejo: sin columnas de coordenadas");
    const viejo = csv([["codigo", "nombre", "sitio"], ["LUM-0003", "Sin coordenadas", "GPE"]]);
    const vViejo = await validarImportacion({ tipo: "activos", contenido: viejo, ...ctx });
    revisar("el archivo de siempre sigue validando", vViejo.puedeImportar && vViejo.totales.errores === 0, vViejo.totales);
    await ejecutarImportacion({ tipo: "activos", contenido: viejo, ...ctx });
    const a3 = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: "LUM-0003" } });
    revisar("y las coordenadas quedan nulas, no en 0,0", a3.latitud === null && a3.longitud === null);

    console.log("\n4. Lo que no debe pasar");
    const malos = csv([
      ["codigo", "nombre", "sitio", "latitud", "longitud"],
      ["M-1", "Solo latitud", "GPE", "25.67", ""],
      ["M-2", "Latitud fuera de rango", "GPE", "125.67", "-100.2"],
      ["M-3", "Coma como decimal", "GPE", '"25,67"', "-100.2"],
      ["M-4", "Texto", "GPE", "norte", "-100.2"],
      ["M-5", "Fuera de México", "GPE", "40.4", "-3.7"],
    ]);
    const vMalos = await validarImportacion({ tipo: "activos", contenido: malos, ...ctx });
    const fila = (n: number) => vMalos.filas.find((f) => f.fila === n)!;
    revisar("una sola coordenada es error (fila 2)", fila(2).estado === "error" && fila(2).fallas.some((f) => f.columna === "longitud"), fila(2).fallas);
    revisar("latitud 125 es error (fila 3)", fila(3).estado === "error" && fila(3).fallas.some((f) => f.columna === "latitud"), fila(3).fallas);
    revisar("«25,67» es error y explica el punto decimal (fila 4)", fila(4).estado === "error" && fila(4).fallas.some((f) => f.columna === "latitud"), fila(4).fallas);
    revisar("«norte» es error y se dice una sola vez (fila 5)", fila(5).estado === "error" && fila(5).fallas.length === 1, fila(5).fallas);
    revisar("fuera de México avisa pero no bloquea (fila 6)",
      fila(6).estado === "nuevo" && fila(6).advertencias.some((a) => a.columna === "longitud"), fila(6));
    revisar("con errores no se puede importar", !vMalos.puedeImportar);
    revisar("nada de lo malo quedó guardado", (await prisma.asset.count({ where: { organizationId: org.id, code: { startsWith: "M-" } } })) === 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
  }
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
