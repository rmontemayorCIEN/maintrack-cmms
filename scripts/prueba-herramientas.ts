/**
 * Herramientas: prestar, devolver y dar de baja.
 *
 * Llama a las MISMAS funciones que la pantalla y la API.
 *
 * Lo que más vigila es lo que sostiene todo el diseño:
 *
 *   · prestar y devolver NO tocan la existencia ni el costo promedio,
 *   · dar de baja SÍ, y pasa por el único camino que mueve stock,
 *   · el reporte de pérdidas NO le atribuye a nadie el desgaste normal,
 *   · no se presta más de lo que hay disponible,
 *   · una refacción no se presta, y cada empresa ve solo lo suyo.
 *
 *   npx tsx scripts/prueba-herramientas.ts
 */
import { prisma } from "../lib/db";
import { aplicarMovimiento } from "../lib/almacen";
import {
  avisarDeLoNoDevuelto, darDeBaja, devolver, loQueEstaFuera, panoramaDeHerramientas,
  perdidasPorPersona, prestar, quienTraeQue,
} from "../lib/herramientas";
import { disponible, diasFuera, regresoPeor, seLeAtribuye } from "../lib/herramientas-tipos";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}

const DIA = 86_400_000;

async function main() {
  console.log("\n1. Las cuentas puras\n");
  revisar("disponible es lo que hay menos lo prestado", disponible(10, 3) === 7);
  revisar("nunca da negativo, aunque haya descuadre", disponible(2, 5) === 0);
  revisar("los días fuera se cuentan desde la entrega", diasFuera(new Date(Date.now() - 5 * DIA)) === 5);
  revisar("volver PARA_REPARAR habiendo salido BUENA es regresar peor", regresoPeor("BUENA", "PARA_REPARAR"));
  revisar("volver igual no es regresar peor", !regresoPeor("USADA", "USADA"));
  revisar("sin estado de salida no se afirma nada", !regresoPeor(null, "PARA_REPARAR"));
  revisar("una pérdida se le atribuye a quien la traía", seLeAtribuye("PERDIDA"));
  revisar("el fin de vida útil NO se le atribuye a nadie", !seLeAtribuye("FIN_DE_VIDA"));

  const sello = `prueba-her-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const almacenista = await prisma.user.create({
      data: { organizationId: A.id, email: `alm${Date.now()}@x.com`, name: "Almacenista", passwordHash: "x", role: "SUPERVISOR" },
    });
    const pedro = await prisma.user.create({
      data: { organizationId: A.id, email: `p${Date.now()}@x.com`, name: "Pedro", passwordHash: "x", role: "TECHNICIAN" },
    });
    const ana = await prisma.user.create({
      data: { organizationId: A.id, email: `a${Date.now()}@x.com`, name: "Ana", passwordHash: "x", role: "TECHNICIAN" },
    });
    const ajeno = await prisma.user.create({
      data: { organizationId: B.id, email: `x${Date.now()}@x.com`, name: "De otra empresa", passwordHash: "x", role: "TECHNICIAN" },
    });

    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "HER", name: "Almacén de herramientas", esGeneral: true, responsableId: almacenista.id },
    });
    const carrito = await prisma.warehouse.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "CAR", name: "Carrito del torno", autoservicio: true },
    });

    const calibrador = await prisma.part.create({
      data: { organizationId: A.id, code: "CAL-01", name: "Calibrador digital", naturaleza: "HERRAMIENTA", unitCost: 50_000, unit: "pza" },
    });
    const pinzas = await prisma.part.create({
      data: { organizationId: A.id, code: "PIN-01", name: "Pinzas de presión", naturaleza: "HERRAMIENTA", unitCost: 200, unit: "pza" },
    });
    const rodamiento = await prisma.part.create({
      data: { organizationId: A.id, code: "ROD-01", name: "Rodamiento 6205", naturaleza: "REFACCION", unitCost: 120, unit: "pza" },
    });

    const meter = async (part: string, almacenId: string, cantidad: number, costo: number) => {
      await prisma.partStock.upsert({
        where: { partId_warehouseId: { partId: part, warehouseId: almacenId } },
        create: { organizationId: A.id, partId: part, warehouseId: almacenId, quantity: 0 },
        update: {},
      });
      await aplicarMovimiento({
        organizationId: A.id, partId: part, warehouseId: almacenId,
        tipo: "IN", cantidad, costoUnitario: costo, motivo: "COMPRA", referencia: "alta inicial",
      });
    };
    await meter(calibrador.id, almacen.id, 2, 50_000);
    await meter(pinzas.id, almacen.id, 10, 200);
    await meter(pinzas.id, carrito.id, 4, 200);
    await meter(rodamiento.id, almacen.id, 20, 120);

    const existencia = (part: string, w: string) =>
      prisma.partStock.findUniqueOrThrow({ where: { partId_warehouseId: { partId: part, warehouseId: w } }, select: { quantity: true, enResguardo: true } });
    const costoDe = (id: string) => prisma.part.findUniqueOrThrow({ where: { id }, select: { unitCost: true, quantityOnHand: true } });

    console.log("\n2. Prestar\n");
    const antesCosto = await costoDe(calibrador.id);
    const p1 = await prestar({
      organizationId: A.id, partId: calibrador.id, warehouseId: almacen.id,
      personaId: pedro.id, entregadoPorId: almacenista.id, estadoSalida: "BUENA", proposito: "Calibrar la línea 1",
    });
    revisar("se presta el calibrador", p1.ok, p1.ok ? undefined : p1.motivo);

    const trasPrestar = await existencia(calibrador.id, almacen.id);
    revisar("la EXISTENCIA no bajó: prestar mueve posesión, no valor",
      trasPrestar.quantity === 2, trasPrestar);
    revisar("lo que subió es lo que está en resguardo", trasPrestar.enResguardo === 1, trasPrestar);
    revisar("y queda 1 disponible", disponible(trasPrestar.quantity, trasPrestar.enResguardo) === 1);

    const despuesCosto = await costoDe(calibrador.id);
    revisar("el COSTO PROMEDIO no se movió: una devolución no es una compra",
      despuesCosto.unitCost === antesCosto.unitCost, { antes: antesCosto.unitCost, despues: despuesCosto.unitCost });
    const kardexTrasPrestar = await prisma.stockMovement.count({ where: { organizationId: A.id, partId: calibrador.id } });
    revisar("y el kardex NO registró nada: el préstamo no es un movimiento de almacén",
      kardexTrasPrestar === 1, { movimientos: kardexTrasPrestar });

    console.log("\n3. Lo que no se presta\n");
    const refa = await prestar({ organizationId: A.id, partId: rodamiento.id, warehouseId: almacen.id, personaId: pedro.id, entregadoPorId: almacenista.id });
    revisar("una REFACCIÓN no se presta: se consume",
      !refa.ok && refa.motivo.includes("se consume"), refa.ok ? undefined : refa.motivo);

    await prestar({ organizationId: A.id, partId: calibrador.id, warehouseId: almacen.id, personaId: ana.id, entregadoPorId: almacenista.id, estadoSalida: "BUENA" });
    const tercero = await prestar({ organizationId: A.id, partId: calibrador.id, warehouseId: almacen.id, personaId: pedro.id, entregadoPorId: almacenista.id });
    revisar("no se presta más de lo disponible, aunque la existencia diga 2",
      !tercero.ok && tercero.motivo.includes("está prestado"), tercero.ok ? undefined : tercero.motivo);

    const sinFirma = await prestar({ organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id, personaId: pedro.id });
    revisar("en un almacén con almacenista hay que decir quién entregó",
      !sinFirma.ok && sinFirma.motivo.includes("almacenista"), sinFirma.ok ? undefined : sinFirma.motivo);

    const enCarrito = await prestar({ organizationId: A.id, partId: pinzas.id, warehouseId: carrito.id, personaId: pedro.id });
    revisar("en autoservicio NO hace falta segunda firma", enCarrito.ok, enCarrito.ok ? undefined : enCarrito.motivo);

    console.log("\n4. Cada empresa ve solo lo suyo\n");
    revisar("no se le presta a alguien de otra empresa",
      !(await prestar({ organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id, personaId: ajeno.id, entregadoPorId: almacenista.id })).ok);
    revisar("la otra empresa no puede prestar esta herramienta",
      !(await prestar({ organizationId: B.id, partId: pinzas.id, warehouseId: almacen.id, personaId: ajeno.id })).ok);
    revisar("ni entregarla alguien de otra empresa",
      !(await prestar({ organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id, personaId: pedro.id, entregadoPorId: ajeno.id })).ok);
    revisar("desde la otra empresa no se ve nada fuera", (await loQueEstaFuera(B.id)).length === 0);

    console.log("\n5. Devolver\n");
    const fuera1 = await loQueEstaFuera(A.id);
    revisar("hay tres cosas fuera", fuera1.length === 3, fuera1.map((r) => `${r.articulo.code}/${r.persona.name}`));

    const deAna = fuera1.find((r) => r.personaId === ana.id)!;
    const dev = await devolver({ organizationId: A.id, resguardoId: deAna.id, recibidoPorId: almacenista.id, estadoRegreso: "PARA_REPARAR" });
    revisar("se devuelve", dev.ok, dev.ok ? undefined : dev.motivo);
    revisar("y se nota que regresó peor de como salió", dev.ok && dev.dato.regresoPeor === true);

    const trasDevolver = await existencia(calibrador.id, almacen.id);
    revisar("al devolver, la existencia sigue igual y baja lo que está fuera",
      trasDevolver.quantity === 2 && trasDevolver.enResguardo === 1, trasDevolver);
    const costoTrasDevolver = await costoDe(calibrador.id);
    revisar("el costo promedio SIGUE intacto después de ir y volver",
      costoTrasDevolver.unitCost === antesCosto.unitCost, costoTrasDevolver.unitCost);

    revisar("no se devuelve dos veces",
      !(await devolver({ organizationId: A.id, resguardoId: deAna.id })).ok);
    revisar("ni desde otra empresa",
      !(await devolver({ organizationId: B.id, resguardoId: deAna.id })).ok);

    console.log("\n6. Dar de baja: aquí SÍ se mueve el dinero\n");
    const deQuienSePierde = (await loQueEstaFuera(A.id)).find((r) => r.personaId === pedro.id && r.articulo.id === calibrador.id)!;
    const baja = await darDeBaja({ organizationId: A.id, resguardoId: deQuienSePierde.id, motivo: "PERDIDA", userId: almacenista.id });
    revisar("se da de baja el calibrador que traía Pedro", baja.ok, baja.ok ? undefined : baja.motivo);
    revisar("y el costo sale del costo promedio del almacén, no de un número inventado",
      baja.ok && baja.dato.costo === 50_000, baja.ok ? baja.dato : undefined);

    const trasBaja = await existencia(calibrador.id, almacen.id);
    revisar("AHORA sí bajó la existencia", trasBaja.quantity === 1, trasBaja);
    revisar("y dejó de estar «fuera»", trasBaja.enResguardo === 0, trasBaja);
    const kardexTrasBaja = await prisma.stockMovement.findMany({
      where: { organizationId: A.id, partId: calibrador.id }, orderBy: { createdAt: "desc" }, take: 1,
      select: { movementType: true, quantity: true, motivo: true },
    });
    revisar("quedó en el kardex como salida, con su motivo",
      kardexTrasBaja[0]?.movementType === "OUT" && kardexTrasBaja[0]?.quantity === 1, kardexTrasBaja[0]);

    revisar("una herramienta ya devuelta no se da de baja por su resguardo",
      !(await darDeBaja({ organizationId: A.id, resguardoId: deAna.id, motivo: "PERDIDA" })).ok);
    revisar("un motivo inventado se rechaza",
      !(await darDeBaja({ organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id, motivo: "PORQUE_SI" })).ok);

    console.log("\n7. El reporte que vende el módulo\n");
    // A Pedro se le pierde otro calibrador; y una pinza termina su vida util.
    await meter(calibrador.id, almacen.id, 1, 50_000);
    const otro = await prestar({ organizationId: A.id, partId: calibrador.id, warehouseId: almacen.id, personaId: pedro.id, entregadoPorId: almacenista.id });
    if (otro.ok) await darDeBaja({ organizationId: A.id, resguardoId: otro.dato.id, motivo: "PERDIDA", userId: almacenista.id });

    const dePinza = (await loQueEstaFuera(A.id)).find((r) => r.articulo.id === pinzas.id)!;
    await darDeBaja({ organizationId: A.id, resguardoId: dePinza.id, motivo: "FIN_DE_VIDA", userId: almacenista.id });

    const reporte = await perdidasPorPersona(A.id);
    revisar("el reporte nombra a Pedro", reporte.personas[0]?.persona.name === "Pedro", reporte.personas.map((p) => p.persona.name));
    revisar("con los dos calibradores y su costo real",
      reporte.personas[0]?.piezas === 2 && reporte.personas[0]?.costo === 100_000, reporte.personas[0]);
    revisar("y dice QUÉ se le pierde",
      reporte.personas[0]?.herramientas[0]?.code === "CAL-01", reporte.personas[0]?.herramientas);
    revisar("el fin de vida útil NO se le atribuye a nadie",
      reporte.costoTotal === 100_000 && !reporte.personas.some((p) => p.herramientas.some((h) => h.code === "PIN-01")),
      { total: reporte.costoTotal });
    revisar("pero tampoco se esconde: se informa aparte como desgaste",
      reporte.porDesgaste.piezas === 1 && reporte.porDesgaste.costo === 200, reporte.porDesgaste);
    revisar("la otra empresa no ve nada", (await perdidasPorPersona(B.id)).personas.length === 0);

    console.log("\n8. Quién trae qué, y lo que se tardó\n");
    // Para este punto ya se devolvió o se dio de baja todo, así que se vuelve
    // a prestar: sin esto el bloque se saltaba en silencio y el aviso de lo no
    // devuelto no se probaba nunca, que es peor que una falla.
    const paraElAviso = await prestar({
      organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id,
      personaId: pedro.id, entregadoPorId: almacenista.id, estadoSalida: "BUENA",
    });
    await prestar({
      organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id,
      personaId: ana.id, entregadoPorId: almacenista.id, estadoSalida: "NUEVA", cantidad: 2,
    });
    revisar("hay algo fuera para agrupar", paraElAviso.ok, paraElAviso.ok ? undefined : paraElAviso.motivo);

    const quien = await quienTraeQue(A.id);
    revisar("agrupa por persona", quien.length === 2, quien.map((q) => `${q.persona.name}:${q.piezas}`));
    revisar("y valúa lo que trae cada quien",
      quien.every((q) => q.valor > 0) && quien.reduce((a, q) => a + q.piezas, 0) === 3,
      quien.map((q) => ({ quien: q.persona.name, piezas: q.piezas, valor: q.valor })));

    // Se envejece un resguardo para que dispare el aviso.
    const vivo = (await loQueEstaFuera(A.id))[0];
    revisar("hay un resguardo abierto que envejecer", Boolean(vivo));
    if (vivo) {
      await prisma.resguardo.update({ where: { id: vivo.id }, data: { entregadoEl: new Date(Date.now() - 40 * DIA) } });
      const fueraViejo = await loQueEstaFuera(A.id);
      revisar("lo que lleva mucho fuera queda marcado", fueraViejo.some((r) => r.seTardo));
      const aviso = await avisarDeLoNoDevuelto(A.id);
      revisar("y se le avisa al responsable del almacén", aviso.avisados >= 1, aviso);
      const guardado = await prisma.notification.count({ where: { organizationId: A.id, userId: almacenista.id } });
      revisar("el aviso queda guardado, aunque el canal falle", guardado >= 1, { avisos: guardado });
    }

    console.log("\n9. El panorama\n");
    const pan = await panoramaDeHerramientas(A.id);
    revisar("cuenta solo herramientas, no refacciones",
      pan.cuantas === 2 && !pan.filas.some((f) => f.code === "ROD-01"), pan.filas.map((f) => f.code));
    revisar("separa lo que hay, lo prestado y lo libre",
      pan.filas.every((f) => f.libres === Math.max(0, f.total - f.prestadas)), pan.filas.map((f) => ({ c: f.code, t: f.total, p: f.prestadas, l: f.libres })));
    revisar("y valúa el almacén de herramientas", pan.valorTotal > 0, pan.valorTotal);

    console.log("\n10. La unidad serializada: el dado\n");
    /*
     * El caso que Rafael marcó con «ojo aquí»: un dado no se rectifica cada
     * seis meses, se rectifica cada X piezas. Se modela como ACTIVO —no como
     * un modelo nuevo— y por eso hereda el medidor y el plan por uso que ya
     * existen.
     */
    const dado = await prisma.asset.create({
      data: {
        organizationId: A.id, siteId: sitio.id, code: "DAD-01", name: "Dado de fresadora 40 mm",
        sePresta: true, purchaseCost: 18_000, replacementCost: 20_000,
      },
    });
    const noPrestable = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "TOR-01", name: "Torno CNC", sePresta: false },
    });
    const medidor = await prisma.meter.create({
      data: { organizationId: A.id, assetId: dado.id, name: "Piezas maquinadas", tipo: "CICLOS", unit: "pzas", currentValue: 4_200 },
    });

    revisar("un equipo que NO se presta se rechaza, y lo dice",
      !(await prestar({ organizationId: A.id, assetId: noPrestable.id, personaId: pedro.id, entregadoPorId: almacenista.id })).ok);
    revisar("no se puede pedir refacción y unidad a la vez",
      !(await prestar({ organizationId: A.id, partId: pinzas.id, warehouseId: almacen.id, assetId: dado.id, personaId: pedro.id, entregadoPorId: almacenista.id })).ok);
    revisar("ni ninguna de las dos",
      !(await prestar({ organizationId: A.id, personaId: pedro.id, entregadoPorId: almacenista.id })).ok);
    revisar("un equipo de otra empresa no se presta",
      !(await prestar({ organizationId: B.id, assetId: dado.id, personaId: ajeno.id })).ok);

    const conDado = await prestar({
      organizationId: A.id, assetId: dado.id, personaId: pedro.id,
      entregadoPorId: almacenista.id, estadoSalida: "BUENA", proposito: "Corrida de 800 piezas",
    });
    revisar("el dado se presta", conDado.ok, conDado.ok ? undefined : conDado.motivo);

    const repetido = await prestar({ organizationId: A.id, assetId: dado.id, personaId: ana.id, entregadoPorId: almacenista.id });
    revisar("una unidad ya prestada NO se presta dos veces, y dice quién la tiene",
      !repetido.ok && repetido.motivo.includes("Pedro"), repetido.ok ? undefined : repetido.motivo);

    const fueraConDado = await loQueEstaFuera(A.id);
    const elDado = fueraConDado.find((r) => r.assetId === dado.id)!;
    revisar("aparece entre lo que está fuera, con su nombre", elDado?.articulo.code === "DAD-01", elDado?.articulo);
    revisar("y se valúa con lo que cuesta reponerlo", elDado?.articulo.costo === 20_000, elDado?.articulo.costo);
    revisar("va marcado como serializada", elDado?.articulo.serializada === true);

    console.log("\n11. Al devolverlo se captura el uso, y eso mueve el plan\n");
    const devDado = await devolver({
      organizationId: A.id, resguardoId: elDado.id, recibidoPorId: almacenista.id,
      estadoRegreso: "USADA", lectura: { meterId: medidor.id, valor: 5_000 },
    });
    revisar("se devuelve y se registra la lectura", devDado.ok && devDado.dato.avisoDeLectura === null,
      devDado.ok ? devDado.dato : devDado.motivo);
    const trasUso = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id }, select: { currentValue: true } });
    revisar("el contador del dado subió a lo que se capturó", trasUso.currentValue === 5_000, trasUso);
    const lecturas = await prisma.meterReading.count({ where: { meterId: medidor.id } });
    revisar("y quedó como lectura, por el mismo camino que cualquier otra", lecturas === 1, { lecturas });

    // Una lectura mala NO debe tirar la devolucion: la herramienta si regreso.
    await prestar({ organizationId: A.id, assetId: dado.id, personaId: ana.id, entregadoPorId: almacenista.id, estadoSalida: "USADA" });
    const otraVez = (await loQueEstaFuera(A.id)).find((r) => r.assetId === dado.id)!;
    const conLecturaMala = await devolver({
      organizationId: A.id, resguardoId: otraVez.id, recibidoPorId: almacenista.id,
      estadoRegreso: "USADA", lectura: { meterId: medidor.id, valor: 10 },
    });
    revisar("una lectura imposible NO tira la devolución: la herramienta sí regresó",
      conLecturaMala.ok && Boolean(conLecturaMala.dato.avisoDeLectura),
      conLecturaMala.ok ? conLecturaMala.dato.avisoDeLectura : conLecturaMala.motivo);
    const sigueFuera = (await loQueEstaFuera(A.id)).some((r) => r.assetId === dado.id);
    revisar("y el dado ya no aparece como prestado", !sigueFuera);
    const contadorIgual = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id }, select: { currentValue: true } });
    revisar("el contador NO retrocedió", contadorIgual.currentValue === 5_000, contadorIgual);

    const deOtroEquipo = await prisma.meter.create({
      data: { organizationId: A.id, assetId: noPrestable.id, name: "Horómetro", unit: "h", currentValue: 10 },
    });
    await prestar({ organizationId: A.id, assetId: dado.id, personaId: pedro.id, entregadoPorId: almacenista.id });
    const tercera = (await loQueEstaFuera(A.id)).find((r) => r.assetId === dado.id)!;
    const medidorAjeno = await devolver({
      organizationId: A.id, resguardoId: tercera.id, recibidoPorId: almacenista.id,
      lectura: { meterId: deOtroEquipo.id, valor: 99 },
    });
    revisar("un medidor que no es de ese equipo se rechaza, sin tirar la devolución",
      medidorAjeno.ok && Boolean(medidorAjeno.dato.avisoDeLectura),
      medidorAjeno.ok ? medidorAjeno.dato.avisoDeLectura : undefined);

    console.log("\n12. Perder una unidad serializada\n");
    await prestar({ organizationId: A.id, assetId: dado.id, personaId: pedro.id, entregadoPorId: almacenista.id });
    const paraPerder = (await loQueEstaFuera(A.id)).find((r) => r.assetId === dado.id)!;
    const bajaDado = await darDeBaja({ organizationId: A.id, resguardoId: paraPerder.id, motivo: "PERDIDA", userId: almacenista.id });
    revisar("se da de baja con lo que cuesta reponerlo", bajaDado.ok && bajaDado.dato.costo === 20_000,
      bajaDado.ok ? bajaDado.dato : bajaDado.motivo);
    const dadoTrasBaja = await prisma.asset.findUniqueOrThrow({ where: { id: dado.id }, select: { active: true } });
    revisar("y el equipo queda dado de baja", dadoTrasBaja.active === false);
    const kardexDelDado = await prisma.stockMovement.count({ where: { organizationId: A.id, partId: dado.id } });
    revisar("sin tocar el kardex: una unidad serializada no lleva existencia", kardexDelDado === 0);

    const reporteFinal = await perdidasPorPersona(A.id);
    const dePedro = reporteFinal.personas.find((x) => x.persona.name === "Pedro")!;
    revisar("el dado entra al reporte de pérdidas de Pedro",
      dePedro.herramientas.some((h) => h.code === "DAD-01" && h.costo === 20_000),
      dePedro.herramientas);
  } finally {
    await prisma.organization.delete({ where: { id: A.id } });
    await prisma.organization.delete({ where: { id: B.id } });
  }

  console.log(fallos === 0 ? "\n✓ Todo pasa\n" : `\n✗ ${fallos} fallas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
