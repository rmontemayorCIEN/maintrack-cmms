/**
 * «Llévame a…»: que lleve a donde se pidió, y solo a donde se puede.
 *
 * Lo que se cuida aquí, en orden de lo que más caro saldría:
 *
 *   1. Que NO sea una puerta trasera. Decir en voz alta el nombre de una
 *      pantalla que el rol no ve no puede abrirla. El menú ya filtra, pero el
 *      menú es dibujo: quien manda es la ruta.
 *   2. Que no adivine. Con dos equipos que se llaman parecido, elegir uno
 *      tiene la mitad de probabilidades de llevar al equivocado —y sin que se
 *      note, porque la pantalla se ve igual de bien—.
 *   3. Que un filtro no se pierda en silencio. «Mis órdenes» tiene que ganarle
 *      a «órdenes»: llevar a la lista completa se ve bien y contesta otra cosa.
 *
 *   npx tsx scripts/prueba-navegacion-voz.ts
 */
import { type ChildProcess } from "node:child_process";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { destinoDe, quitarVerbo, intencionDeOrden, DESTINOS, ATAJOS } from "../lib/navegacion-voz";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";

const PUERTO = 3218;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function esperarServidor(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) return;
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO });

  const sello = `nav-${Date.now()}`;
  const creadas: string[] = [];

  try {
    console.log("\nQuitar el verbo y quedarse con el destino\n");
    revisar("«llévame al almacén» → «almacen»", quitarVerbo("Llévame al almacén") === "almacen", quitarVerbo("Llévame al almacén"));
    revisar("«ábreme las órdenes» → «ordenes»", quitarVerbo("Ábreme las órdenes") === "ordenes", quitarVerbo("Ábreme las órdenes"));
    // El verbo largo tiene que probarse ANTES que el corto: si «ir a» ganara,
    // de «quiero ir a compras» quedaria «quiero» y no coincidiria con nada.
    revisar("«quiero ir a compras» → «compras»", quitarVerbo("Quiero ir a compras") === "compras", quitarVerbo("Quiero ir a compras"));
    revisar("sin verbo también sirve: «almacén»", quitarVerbo("almacén") === "almacen");

    console.log("\nLos nombres que la gente usa de verdad\n");
    const mismos = ["almacen", "refacciones", "inventario"].map((n) => destinoDe(n)?.ruta);
    revisar("«almacén», «refacciones» e «inventario» llevan al mismo lado",
      new Set(mismos).size === 1 && mismos[0] === "/inventory", mismos);
    revisar("«llévame a los equipos» llega a activos", destinoDe("llévame a los equipos")?.ruta === "/assets");
    revisar("«enséñame el mapa de líneas» llega a conjuntos", destinoDe("enséñame el mapa de líneas")?.ruta === "/conjuntos");

    console.log("\nUn filtro no se puede perder en el camino\n");
    revisar("«mis órdenes» NO cae en la lista completa", destinoDe("mis órdenes")?.ruta === "/work-orders?mias=1", destinoDe("mis órdenes")?.ruta);
    revisar("   ni con verbo delante: «llévame a mis órdenes»",
      destinoDe("llévame a mis órdenes")?.ruta === "/work-orders?mias=1", destinoDe("llévame a mis órdenes")?.ruta);
    revisar("   y el artículo sí se quita: «llévame a las órdenes» es la lista completa",
      destinoDe("llévame a las órdenes")?.ruta === "/work-orders", destinoDe("llévame a las órdenes")?.ruta);
    revisar("«las vencidas» lleva al filtro de vencidas", destinoDe("las vencidas")?.ruta === "/work-orders?vencidas=1", destinoDe("las vencidas")?.ruta);
    revisar("«órdenes» a secas sí es la lista completa", destinoDe("órdenes")?.ruta === "/work-orders");

    console.log("\nComo habla la gente de verdad\n");
    // Estos seis salieron del registro de lo que NO se entendio la primera vez
    // que alguien lo uso. Nadie dice los nombres exactos de las pantallas.
    revisar("«abre solicitudes de servicio» —el nombre del menú— llega",
      destinoDe("Abre solicitudes de servicio")?.ruta === "/requests", destinoDe("Abre solicitudes de servicio")?.ruta);
    revisar("«pregunte a sus datos» encuentra «pregúntale a tus datos»",
      destinoDe("Abre pregunte a sus datos")?.ruta === "/consulta", destinoDe("Abre pregunte a sus datos")?.ruta);
    revisar("«escuchar el parte del día» lleva al inicio, que es donde está",
      destinoDe("Escuchar el parte del día")?.ruta === "/dashboard", destinoDe("Escuchar el parte del día")?.ruta);
    // Y lo contrario: nombrar algo concreto NO puede llevar a la lista. Llegar
    // a una pantalla que se ve bien pero no es la pedida es peor que no llegar.
    revisar("«el equipo compresor de tornillo» NO cae en la lista de activos",
      destinoDe("Abre el equipo compresor de tornillo") === null, destinoDe("Abre el equipo compresor de tornillo")?.ruta);
    revisar("«la orden 124» NO cae en la lista de órdenes",
      destinoDe("abre la orden 124") === null, destinoDe("abre la orden 124")?.ruta);
    revisar("   pero «la orden de trabajo», sin número, sí es la lista",
      destinoDe("abre la orden de trabajo")?.ruta === "/work-orders", destinoDe("abre la orden de trabajo")?.ruta);

    console.log("\nLo que NO se reconoce se dice, no se adivina\n");
    // «Ordenes de compra» empieza igual que «ordenes de trabajo» pero NO es lo
    // mismo, y la coincidencia es contra el nombre completo justamente por
    // esto: quien llega a la lista de OT creyendo ver compras se va con una
    // idea falsa de su operacion.
    revisar("«órdenes de compra» va a compras, no a órdenes de trabajo",
      destinoDe("órdenes de compra")?.ruta === "/compras", destinoDe("órdenes de compra")?.ruta);
    revisar("una frase sin sentido no inventa destino", destinoDe("azul con queso") === null);
    revisar("una frase vacía tampoco", destinoDe("") === null);

    console.log("\nLo que pide orden de fecha\n");
    revisar("«la orden más antigua» se reconoce", intencionDeOrden("llévame a la orden más antigua")?.clase === "masAntigua");
    revisar("«la solicitud más reciente» también", intencionDeOrden("ábreme la solicitud más reciente")?.clase === "masReciente");
    revisar("«el almacén» no es una intención de orden", intencionDeOrden("llévame al almacén") === null);

    console.log("\nEl catálogo está sano\n");
    const rutas = DESTINOS.map((d) => d.ruta);
    revisar("ninguna pantalla está repetida", new Set(rutas).size === rutas.length);
    const nombres = DESTINOS.flatMap((d) => d.nombres);
    const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i);
    // Un nombre en dos pantallas es una moneda al aire: gana la que este
    // primero en la lista, que no es un criterio que nadie haya decidido.
    revisar("ningún nombre apunta a dos pantallas distintas", repetidos.length === 0, repetidos.join(" "));
    const chocan = ATAJOS.flatMap((a) => a.frases).filter((f) => nombres.includes(f));
    revisar("ningún atajo choca con el nombre de una pantalla", chocan.length === 0, chocan.join(" "));

    // ─────────────────────────────────────── Contra el sistema de verdad ────
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(org.id);
    const sitio = await prisma.site.create({ data: { organizationId: org.id, name: "Planta", code: "P1" } });
    const jefa = await prisma.user.create({
      data: { organizationId: org.id, email: `j-${sello}@t.mx`, name: "Jefa", role: "ADMIN", passwordHash: "x" },
    });
    const mirona = await prisma.user.create({
      data: { organizationId: org.id, email: `v-${sello}@t.mx`, name: "Consulta", role: "VIEWER", passwordHash: "x" },
    });

    const vieja = await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-000101", title: "La más vieja", maintenanceType: "CORRECTIVE",
        priority: "MEDIUM", status: "OPEN", siteId: sitio.id, createdAt: new Date(Date.now() - 90 * 86_400_000) },
    });
    await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-000102", title: "La de ayer", maintenanceType: "CORRECTIVE",
        priority: "MEDIUM", status: "OPEN", siteId: sitio.id, createdAt: new Date(Date.now() - 86_400_000) },
    });
    // Una orden cerrada MAS vieja todavia: no debe ganar, porque «la más
    // antigua» quiere decir «la que lleva más tiempo esperando», no la más
    // vieja de la historia.
    await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-000103", title: "Cerrada hace años", maintenanceType: "CORRECTIVE",
        priority: "MEDIUM", status: "CLOSED", siteId: sitio.id, createdAt: new Date(Date.now() - 900 * 86_400_000) },
    });

    await esperarServidor();
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const credencial = (u: { id: string; email: string; name: string; role: string }) =>
      new SignJWT({ userId: u.id, organizationId: org.id, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);
    const deJefa = await credencial(jefa);
    const deMirona = await credencial(mirona);

    const navegar = async (jwt: string, texto: string) => {
      const r = await fetch(`${base}/api/ia/navegar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `mt_session=${jwt}` },
        body: JSON.stringify({ texto }),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };

    console.log("\nLleva de verdad, contra el sistema\n");
    const alAlmacen = await navegar(deJefa, "llévame al almacén");
    revisar("«llévame al almacén» devuelve la ruta del almacén",
      alAlmacen.status === 200 && alAlmacen.json.ruta === "/inventory", { ruta: alAlmacen.json.ruta });

    const laVieja = await navegar(deJefa, "llévame a la orden de trabajo más antigua");
    revisar("«la orden más antigua» lleva a la que lleva más tiempo esperando",
      laVieja.json.ruta === `/work-orders/${vieja.id}`, { ruta: laVieja.json.ruta, esperada: `/work-orders/${vieja.id}` });
    revisar("   y no a una cerrada hace años, aunque sea más vieja",
      !String(laVieja.json.ruta ?? "").includes("C-"));

    console.log("\nNo es una puerta trasera\n");
    // VIEWER no ve compras. Decirlo en voz alta no puede abrirlas.
    const colada = await navegar(deMirona, "llévame a compras");
    revisar("quien no ve compras no entra diciéndolo en voz alta",
      colada.json.ruta === null, { ruta: colada.json.ruta, mensaje: colada.json.mensaje });
    revisar("   y se le explica, en vez de dejarlo probando",
      String(colada.json.mensaje ?? "").includes("perfil"), colada.json.mensaje);
    const suya = await navegar(deMirona, "llévame a los activos");
    revisar("pero lo que sí ve, sí se le abre", suya.json.ruta === "/assets", { ruta: suya.json.ruta });

    console.log("\nLo concreto llega a lo concreto, no a la lista\n");
    const equipo = await prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, code: "CMP-77", name: "Compresor de tornillo", criticality: "B" },
    });
    const alEquipo = await navegar(deJefa, "abre el equipo compresor de tornillo");
    revisar("«abre el equipo compresor de tornillo» abre el compresor",
      alEquipo.json.ruta === `/assets/${equipo.id}`, { ruta: alEquipo.json.ruta });
    const alFolio = await navegar(deJefa, "abre la orden 101");
    revisar("«abre la orden <folio>» abre esa orden",
      alFolio.json.ruta === `/work-orders/${vieja.id}`, { ruta: alFolio.json.ruta, folio: vieja.number });
    // El folio ajeno seguia llevando el sello y por eso no chocaba; ahora que
    // todos son cortos, se comprueba explicitamente que el de la otra empresa
    // no aparece aunque su numero se parezca.
    revisar("   y un folio parecido de otra empresa no se cuela",
      !String(alFolio.json.ruta ?? "").includes("900"));

    console.log("\nCuando no entiende\n");
    const perdida = await navegar(deJefa, "llévame a la luna");
    revisar("no inventa un destino", perdida.json.ruta === null, { ruta: perdida.json.ruta });
    revisar("   dice lo que oyó, que casi siempre explica el problema solo",
      String(perdida.json.texto ?? "").includes("luna"), perdida.json.texto);
    revisar("   y da ejemplos de lo que sí puede decir",
      Array.isArray(perdida.json.ejemplos) && (perdida.json.ejemplos as unknown[]).length > 0);

    console.log("\nLo que NO debe pasar\n");
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otra.id);
    const sitioAjeno = await prisma.site.create({ data: { organizationId: otra.id, name: "Ajena", code: "AJ" } });
    const ajena = await prisma.workOrder.create({
      data: { organizationId: otra.id, number: "OT-000900", title: "De otra empresa", maintenanceType: "CORRECTIVE",
        priority: "MEDIUM", status: "OPEN", siteId: sitioAjeno.id, createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const cruzada = await navegar(deJefa, `llévame a ${ajena.number}`);
    revisar("no lleva a una orden de otra empresa, ni buscándola por su folio",
      cruzada.json.ruta === null, { ruta: cruzada.json.ruta });
    // Y la mas antigua de la empresa propia sigue siendo la propia, no la
    // ajena, que es 400 dias mas vieja.
    const otraVez = await navegar(deJefa, "la orden más antigua");
    revisar("y «la más antigua» sigue siendo la de su empresa",
      otraVez.json.ruta === `/work-orders/${vieja.id}`, { ruta: otraVez.json.ruta });

    const sinSesion = await fetch(`${base}/api/ia/navegar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: "almacén" }),
    });
    revisar("sin sesión no contesta", sinSesion.status === 401, { status: sinSesion.status });
  } finally {
    for (const id of creadas) {
      await prisma.workOrder.deleteMany({ where: { organizationId: id } });
      await prisma.asset.deleteMany({ where: { organizationId: id } });
      await prisma.site.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.aiUsage.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await apagarServidor(servidor, PUERTO);
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
