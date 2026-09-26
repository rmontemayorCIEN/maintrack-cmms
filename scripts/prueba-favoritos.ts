/**
 * Los accesos rapidos del menu.
 *
 * Lo que se cuida aqui son las reglas que no se ven en pantalla:
 *
 *  - Son de la PERSONA, no de la empresa: dos usuarios de la misma cuenta
 *    tienen los suyos y no se pisan.
 *  - No se puede anclar una pantalla que su rol no ve, ni por la ruta directa.
 *  - Si cambia de rol y pierde el acceso, el favorito deja de aparecer pero NO
 *    se borra: recuperado el permiso, vuelve.
 *
 *   npx tsx scripts/prueba-favoritos.ts
 */
import { prisma } from "../lib/db";
import { ErrorDeFavoritos, MAXIMO_FAVORITOS, anclables, favoritosDe, guardarFavoritos } from "../lib/favoritos";
import { etiquetaDeItem, pantallasDelMenu } from "../lib/pantallas";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
}
async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: RegExp) {
  try { await fn(); revisar(afirmacion, false, "no se rechazó"); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, e instanceof ErrorDeFavoritos && (!contiene || contiene.test(m)), m);
  }
}

async function main() {
  const sello = `prueba-fav-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });

  try {
    const jefe = await prisma.user.create({
      data: { organizationId: A.id, email: `j@${sello}.mx`, name: "Dirección", role: "OWNER", passwordHash: "x" },
    });
    const tec = await prisma.user.create({
      data: { organizationId: A.id, email: `t@${sello}.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: "x" },
    });

    // ═══════════════════════════════════════════ 1-3 Lo básico
    console.log("\n1-3. Anclar, ordenar y respetar el tope");
    const delJefe = ["/indicadores", "/reports", "/paros", "/consulta", "/diagnostico"];
    await guardarFavoritos({ organizationId: A.id, userId: jefe.id, rutas: delJefe, rol: "OWNER" });
    const suyos = await favoritosDe(jefe.id, "OWNER");
    revisar("1. quedan en el orden en que se eligieron, con su nombre e ícono del menú",
      suyos.map((i) => i.href).join() === delJefe.join()
      && suyos[0].etiqueta === "Indicadores" && Boolean(suyos[0].icono),
      suyos.map((i) => `${i.etiqueta}`));

    await guardarFavoritos({ organizationId: A.id, userId: jefe.id, rutas: ["/reports", "/indicadores"], rol: "OWNER" });
    const reordenados = await favoritosDe(jefe.id, "OWNER");
    revisar("2. guardar reemplaza la lista completa: sin repetidos ni restos del orden anterior",
      reordenados.map((i) => i.href).join() === "/reports,/indicadores"
      && (await prisma.pantallaFavorita.count({ where: { userId: jefe.id } })) === 2,
      reordenados.map((i) => i.href));

    await rechaza(`3. no caben más de ${MAXIMO_FAVORITOS}: un acceso rápido largo vuelve a ser un menú`,
      () => guardarFavoritos({
        organizationId: A.id, userId: jefe.id,
        rutas: pantallasDelMenu().slice(0, MAXIMO_FAVORITOS + 1).map((i) => i.href), rol: "OWNER",
      }),
      /Caben/);

    // ═══════════════════════════════════════════ 4-6 De cada quien, y por rol
    console.log("\n4-6. De cada quien, y solo lo que su rol ve");
    await guardarFavoritos({ organizationId: A.id, userId: tec.id, rutas: ["/work-orders", "/requisiciones"], rol: "TECHNICIAN" });
    const delTecnico = await favoritosDe(tec.id, "TECHNICIAN");
    const sigueElJefe = await favoritosDe(jefe.id, "OWNER");
    revisar("4. son de la PERSONA: el técnico tiene los suyos y no le movió nada al jefe",
      delTecnico.map((i) => i.href).join() === "/work-orders,/requisiciones"
      && sigueElJefe.map((i) => i.href).join() === "/reports,/indicadores");

    // Un técnico no ve Compras: mandarlo por la ruta directa no lo ancla.
    const conColado = await guardarFavoritos({
      organizationId: A.id, userId: tec.id, rutas: ["/work-orders", "/compras", "/no-existe"], rol: "TECHNICIAN",
    });
    revisar("5. una pantalla que su rol NO ve no se ancla, aunque se mande la ruta a mano",
      conColado.join() === "/work-orders"
      && !anclables("TECHNICIAN").some((i) => i.href === "/compras"),
      conColado);

    // El jefe ancla algo de su rol y luego lo degradan.
    await guardarFavoritos({ organizationId: A.id, userId: jefe.id, rutas: ["/indicadores", "/compras"], rol: "OWNER" });
    const comoTecnico = await favoritosDe(jefe.id, "TECHNICIAN");
    const siguenGuardados = await prisma.pantallaFavorita.count({ where: { userId: jefe.id } });
    revisar("6. si pierde el permiso, el favorito deja de aparecer pero NO se borra: si se lo devuelven, vuelve",
      comoTecnico.length === 0 && siguenGuardados === 2
      && (await favoritosDe(jefe.id, "OWNER")).length === 2,
      { viendoComoTecnico: comoTecnico.length, guardados: siguenGuardados });

    // ═══════════════════════════════════════════ 7 Nada inventado
    console.log("\n7. El menú sigue mandando");
    const todas = anclables("OWNER");
    revisar("7. solo se pueden anclar pantallas del menú: los nombres y los grupos no se tocan",
      todas.length > 20 && todas.every((i) => i.etiqueta && i.icono)
      && todas.every((i) => pantallasDelMenu().some((p) => p.href === i.href && p.etiqueta === i.etiqueta)),
      { anclables: todas.length });


    // ═══════════════════════════════════════════ 8 El mismo nombre en todos lados
    console.log("\n8. Se llama igual aquí y en el menú");
    /*
     * «Conjuntos» se llama «Mapa de lineas» —o como esa empresa llame a los
     * suyos—. La traduccion la hacia SOLO el menu lateral, asi que en «Lo que
     * mas uso» aparecia con el nombre de fabrica: quien la buscaba por el que
     * ve a diario no la encontraba y concluia que no se podia anclar.
     */
    const delMenu = pantallasDelMenu().find((i) => i.porInstalacion);
    revisar("8. hay una pantalla cuyo nombre depende de la instalación", Boolean(delMenu), delMenu?.href);
    revisar("   con nombre propio, se llama como la empresa la llama",
      etiquetaDeItem(delMenu!, "Mapa de líneas") === "Mapa de líneas", etiquetaDeItem(delMenu!, "Mapa de líneas"));
    revisar("   sin nombre propio, se queda con el de fábrica",
      etiquetaDeItem(delMenu!, null) === delMenu!.etiqueta && etiquetaDeItem(delMenu!, "   ") === delMenu!.etiqueta,
      etiquetaDeItem(delMenu!, null));
    const fija = pantallasDelMenu().find((i) => !i.porInstalacion)!;
    revisar("   y a las demás no les cambia el nombre nadie",
      etiquetaDeItem(fija, "Mapa de líneas") === fija.etiqueta, etiquetaDeItem(fija, "Mapa de líneas"));

  } finally {
    await prisma.organization.delete({ where: { id: A.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n✗ ${fallos} fallas` : "\n✓ Cada quien tiene lo suyo a la mano, sin tocar el menú de nadie");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
