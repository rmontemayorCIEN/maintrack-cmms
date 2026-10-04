/**
 * Cumplimiento normativo.
 *
 * Llama a las MISMAS funciones que la pantalla y la API. Lo que más vigila es
 * que el módulo NO mienta, que es el único riesgo grave que tiene:
 *
 *   · una obligación sin nada amarrado NO se cuenta como cumplida ni como
 *     incumplida: se dice que no se sabe,
 *   · el estado de una obligación es el PEOR de sus amarres, no el mejor,
 *   · no se calcula ningún porcentaje de cumplimiento,
 *   · no se puede amarrar el plan de OTRA empresa,
 *   · actualizar desde el catálogo no tira lo que el cliente ya amarró.
 *
 *   npx tsx scripts/prueba-normas.ts
 */
import { prisma } from "../lib/db";
import {
  actualizarDesdeCatalogo, adoptarDelCatalogo, amarrar, crearNormaPropia, desamarrar,
  estadoDeAmarre, estadoDeObligacion, expedienteDeNorma, listarNormas, marcarNoAplica,
  marcarQueAplica, normaPorClave, normasDeLaOrden, normasQueCambiaron, normasSugeridas,
} from "../lib/normas";
import { NORMAS, TOTAL_OBLIGACIONES, normasParaGiro } from "../lib/normas-catalogo";
import { esTipoObligacion, resumirObligaciones, type EstadoObligacion } from "../lib/normas-tipos";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
}

const DIA = 86_400_000;
const AHORA = new Date("2026-09-27T12:00:00Z");
const hace = (d: number) => new Date(AHORA.getTime() - d * DIA);
const dentro = (d: number) => new Date(AHORA.getTime() + d * DIA);

async function main() {
  console.log("\n1. El catálogo está bien formado\n");
  revisar("hay ocho normas", NORMAS.length === 8, NORMAS.map((n) => n.clave));
  revisar("todas traen obligaciones", NORMAS.every((n) => n.obligaciones.length > 0));
  revisar("todos los tipos de obligación existen",
    NORMAS.every((n) => n.obligaciones.every((o) => esTipoObligacion(o.tipo))));
  revisar("las claves de norma no se repiten", new Set(NORMAS.map((n) => n.clave)).size === NORMAS.length);
  revisar("dentro de cada norma, las claves de obligación no se repiten",
    NORMAS.every((n) => new Set(n.obligaciones.map((o) => o.clave)).size === n.obligaciones.length));
  revisar("todas dicen qué NO cubren (es lo que evita la falsa seguridad)",
    NORMAS.every((n) => n.fueraDeAlcance.length > 30));
  revisar("toda obligación dice qué evidencia deja", NORMAS.every((n) => n.obligaciones.every((o) => o.evidencia.length > 10)));
  revisar("una planta ve las ocho", normasParaGiro("PLANTA").length === 8, normasParaGiro("PLANTA").length);
  revisar("un giro desconocido ve el catálogo completo en vez de nada", normasParaGiro("MARCIANO").length === 8);
  revisar("un deportivo ve menos que una planta", normasParaGiro("DEPORTIVO").length < 8, normasParaGiro("DEPORTIVO").map((n) => n.clave));

  console.log("\n2. El estado de un amarre, pieza por pieza\n");
  const e = (x: Parameters<typeof estadoDeAmarre>[0], dias: number | null) => estadoDeAmarre(x, dias, AHORA);
  revisar("un plan apagado está vencido", e({ pieza: "plan", planActivo: false }, 30).estado === "VENCIDA");
  revisar("un plan sin próxima fecha no se sabe", e({ pieza: "plan", planActivo: true, planProxima: null }, 30).estado === "SIN_SABER");
  revisar("un plan que venció está vencido", e({ pieza: "plan", planActivo: true, planProxima: hace(5) }, 30).estado === "VENCIDA");
  revisar("un plan que vence en 5 días está por vencer", e({ pieza: "plan", planActivo: true, planProxima: dentro(5) }, 30).estado === "POR_VENCER");
  revisar("un plan que vence en 60 días está al corriente", e({ pieza: "plan", planActivo: true, planProxima: dentro(60) }, 30).estado === "AL_CORRIENTE");

  const vig = (hasta: Date | null, activa = true) => ({ tipo: "CONTRATO_SERVICIO", hasta, activa, avisarDias: 30 });
  revisar("un documento vencido está vencido", e({ pieza: "vigencia", vigencia: vig(hace(1)) }, null).estado === "VENCIDA");
  revisar("un documento cancelado cuenta como vencido", e({ pieza: "vigencia", vigencia: vig(dentro(300), false) }, null).estado === "VENCIDA");
  revisar("un documento sin vencimiento está al corriente", e({ pieza: "vigencia", vigencia: vig(null) }, null).estado === "AL_CORRIENTE");
  revisar("un documento que vence pronto avisa", e({ pieza: "vigencia", vigencia: vig(dentro(10)) }, null).estado === "POR_VENCER");

  revisar("un registro sin capturas está vencido", e({ pieza: "tabla", ultimaCaptura: null }, 30).estado === "VENCIDA");
  revisar("un registro con captura vieja está vencido", e({ pieza: "tabla", ultimaCaptura: hace(45) }, 30).estado === "VENCIDA");
  revisar("un registro capturado ayer está al corriente", e({ pieza: "tabla", ultimaCaptura: hace(1) }, 30).estado === "AL_CORRIENTE");
  revisar("un registro sin periodo basta con que tenga algo", e({ pieza: "tabla", ultimaCaptura: hace(400) }, null).estado === "AL_CORRIENTE");

  revisar("un rondín sin terminar no se sabe", e({ pieza: "rondin", rondinTerminado: null }, 90).estado === "SIN_SABER");
  revisar("un rondín viejo está vencido", e({ pieza: "rondin", rondinTerminado: hace(120) }, 90).estado === "VENCIDA");
  revisar("una orden sin cerrar no se sabe", e({ pieza: "orden", ordenCerrada: null }, 90).estado === "SIN_SABER");
  revisar("una orden cerrada dentro del periodo está al corriente", e({ pieza: "orden", ordenCerrada: hace(10) }, 90).estado === "AL_CORRIENTE");

  console.log("\n3. Lo que el módulo NO puede hacer: inventar\n");
  revisar("sin amarres, NO se cuenta como cumplida ni como incumplida",
    estadoDeObligacion({ aplica: true }, []) === "SIN_SABER");
  revisar("el estado es el PEOR de los amarres, no el mejor",
    estadoDeObligacion({ aplica: true }, [{ estado: "AL_CORRIENTE" }, { estado: "VENCIDA" }]) === "VENCIDA");
  revisar("con todo al corriente, al corriente",
    estadoDeObligacion({ aplica: true }, [{ estado: "AL_CORRIENTE" }, { estado: "AL_CORRIENTE" }]) === "AL_CORRIENTE");
  revisar("«no aplica» manda sobre cualquier amarre",
    estadoDeObligacion({ aplica: false }, [{ estado: "VENCIDA" }]) === "NO_APLICA");

  const r = resumirObligaciones(["AL_CORRIENTE", "VENCIDA", "SIN_SABER", "NO_APLICA"] as EstadoObligacion[]);
  revisar("el resumen NO devuelve ningún porcentaje", !("porcentaje" in r) && !("cumplimiento" in r), Object.keys(r));
  revisar("lo que no aplica no se considera en el total", r.consideradas === 3, r);
  revisar("el peor estado manda para el color de la norma", r.peor === "VENCIDA");

  const sello = `prueba-nor-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE", tipoInstalacion: "PLANTA" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const quien = await prisma.user.create({
      data: { organizationId: A.id, email: `u${Date.now()}@x.com`, name: "Seguridad", passwordHash: "x", role: "ADMIN" },
    });
    const sitioA = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "S1", name: "Otra" } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitioA.id, code: "EXT-01", name: "Extintor" } });
    const equipoB = await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "X", name: "Ajeno" } });

    const planA = await prisma.maintenancePlan.create({
      data: { organizationId: A.id, name: "Revisión mensual de extintores", intervalDays: 30, active: true, nextDueDate: dentro(20) },
    });
    const planVencido = await prisma.maintenancePlan.create({
      data: { organizationId: A.id, name: "Revisión de sistemas fijos", intervalDays: 90, active: true, nextDueDate: hace(10) },
    });
    const planB = await prisma.maintenancePlan.create({
      data: { organizationId: B.id, name: "Plan ajeno", intervalDays: 30, active: true, nextDueDate: dentro(20) },
    });

    console.log("\n4. Adoptar del catálogo\n");
    const sugeridas = await normasSugeridas(A.id, "PLANTA");
    revisar("a una planta se le proponen las ocho", sugeridas.delGiro.length === 8, sugeridas.delGiro.length);

    const alta = await adoptarDelCatalogo(A.id, "NOM-002-STPS", quien.id);
    revisar("se adopta la NOM-002", alta.ok, alta.ok ? undefined : alta.motivos);
    const repetida = await adoptarDelCatalogo(A.id, "NOM-002-STPS", quien.id);
    revisar("no se adopta dos veces", !repetida.ok);
    revisar("una clave que no existe se rechaza", !(await adoptarDelCatalogo(A.id, "NOM-999", quien.id)).ok);

    const norma = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    revisar("copió sus tres obligaciones", norma.obligaciones.length === 3, norma.obligaciones.map((o) => o.clave));
    revisar("todas arrancan en «sin nada que lo respalde»",
      norma.obligaciones.every((o) => o.estado === "SIN_SABER"));
    revisar("y la norma completa también", norma.resumenEstado.peor === "SIN_SABER", norma.resumenEstado);

    console.log("\n5. Amarrar, y la frontera entre empresas\n");
    const extintores = norma.obligaciones.find((o) => o.clave === "extintores")!;
    const ok1 = await amarrar(A.id, extintores.id, "plan", planA.id, quien.id);
    revisar("se amarra el plan", ok1.ok, ok1.ok ? undefined : ok1.motivos);
    revisar("amarrar dos veces lo mismo se rechaza", !(await amarrar(A.id, extintores.id, "plan", planA.id, quien.id)).ok);

    const ajeno = await amarrar(A.id, extintores.id, "plan", planB.id, quien.id);
    revisar("NO se puede amarrar el plan de otra empresa",
      !ajeno.ok && ajeno.motivos.some((m) => m.includes("no existe en esta empresa")), ajeno.ok ? undefined : ajeno.motivos);
    revisar("ni el equipo de otra empresa como orden", !(await amarrar(A.id, extintores.id, "orden", equipoB.id, quien.id)).ok);
    revisar("desde la otra empresa no se toca esta obligación", !(await amarrar(B.id, extintores.id, "plan", planB.id, quien.id)).ok);

    const conPlan = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    const extConPlan = conPlan.obligaciones.find((o) => o.clave === "extintores")!;
    revisar("con el plan al día, la obligación queda al corriente", extConPlan.estado === "AL_CORRIENTE", extConPlan.amarres);
    revisar("y dice por qué", Boolean(extConPlan.amarres[0]?.porque?.includes("vence en")), extConPlan.amarres[0]?.porque);

    // El peor manda: se le suma un plan vencido a la MISMA obligacion.
    await amarrar(A.id, extintores.id, "plan", planVencido.id, quien.id);
    const conDos = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    const extDos = conDos.obligaciones.find((o) => o.clave === "extintores")!;
    revisar("con un plan al día y otro vencido, la obligación está VENCIDA",
      extDos.estado === "VENCIDA", extDos.amarres.map((a) => a.estado));

    console.log("\n6. «No aplica» también es evidencia\n");
    const sistemas = conDos.obligaciones.find((o) => o.clave === "sistemas-fijos")!;
    revisar("marcar «no aplica» SIN razón se rechaza", !(await marcarNoAplica(A.id, sistemas.id, "   ", quien.id)).ok);
    const naOk = await marcarNoAplica(A.id, sistemas.id, "La planta no tiene red de hidrantes ni rociadores.", quien.id);
    revisar("con razón sí se marca", naOk.ok, naOk.ok ? undefined : naOk.motivos);
    const trasNA = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    const sisNA = trasNA.obligaciones.find((o) => o.clave === "sistemas-fijos")!;
    revisar("queda como «no aplica» con su razón",
      sisNA.estado === "NO_APLICA" && Boolean(sisNA.razonNoAplica), sisNA.razonNoAplica);
    revisar("y deja de contarse en el total", trasNA.resumenEstado.consideradas === 2, trasNA.resumenEstado);
    revisar("se puede volver a considerar", (await marcarQueAplica(A.id, sistemas.id, quien.id)).ok);

    console.log("\n7. Normas propias del cliente\n");
    const sinObl = await crearNormaPropia(A.id, { clave: "ISO 9001", titulo: "Sistema de gestión de calidad", obligaciones: [] }, quien.id);
    revisar("una norma propia sin obligaciones se rechaza", !sinObl.ok, sinObl.ok ? undefined : sinObl.motivos);
    const propia = await crearNormaPropia(A.id, {
      clave: "COR-14", titulo: "Estándar corporativo 14", emisor: "Corporativo",
      obligaciones: [
        { titulo: "Auditoría interna semestral", tipo: "ACTIVIDAD", cadaDias: 180 },
        { titulo: "Carta de conformidad del proveedor", tipo: "DOCUMENTO" },
      ],
    }, quien.id);
    revisar("una norma propia con obligaciones se da de alta", propia.ok, propia.ok ? undefined : propia.motivos);
    const leidaPropia = (await normaPorClave(A.id, "COR-14", AHORA))!;
    revisar("queda marcada como PROPIA (no promete actualizarse)", leidaPropia.origen === "PROPIA");
    revisar("y no dice que cambió, porque nadie la versiona", leidaPropia.cambioDesdeQueLaAdopto === false);
    revisar("un tipo inventado se rechaza",
      !(await crearNormaPropia(A.id, { clave: "X-1", titulo: "X", obligaciones: [{ titulo: "Algo", tipo: "COLOR" }] }, quien.id)).ok);
    revisar("una clave repetida se rechaza",
      !(await crearNormaPropia(A.id, { clave: "COR-14", titulo: "Otra", obligaciones: [{ titulo: "A", tipo: "ACTIVIDAD" }] }, quien.id)).ok);

    console.log("\n8. Qué normas responde una orden (lo que se imprime)\n");
    let n = 0;
    const ordenDelPlan = await prisma.workOrder.create({
      data: {
        organizationId: A.id, number: `OT-${String(++n).padStart(4, "0")}`, title: "Revisión de extintores de septiembre",
        assetId: equipo.id, planId: planA.id, status: "CLOSED", completedAt: hace(3),
      },
    });
    const ordenSuelta = await prisma.workOrder.create({
      data: { organizationId: A.id, number: `OT-${String(++n).padStart(4, "0")}`, title: "Correctivo suelto", assetId: equipo.id, status: "CLOSED", completedAt: hace(2) },
    });
    const deLaOrden = await normasDeLaOrden(A.id, ordenDelPlan.id);
    revisar("la orden que nació del plan hereda la norma del plan",
      deLaOrden.length === 1 && deLaOrden[0].clave === "NOM-002-STPS", deLaOrden);
    revisar("una orden sin relación no trae ninguna", (await normasDeLaOrden(A.id, ordenSuelta.id)).length === 0);

    const recarga = trasNA.obligaciones.find((o) => o.clave === "recarga-extintores")!;
    await amarrar(A.id, recarga.id, "orden", ordenSuelta.id, quien.id);
    revisar("una orden amarrada directo sí trae su norma", (await normasDeLaOrden(A.id, ordenSuelta.id)).length === 1);
    revisar("y desde otra empresa no se ve nada", (await normasDeLaOrden(B.id, ordenDelPlan.id)).length === 0);

    console.log("\n9. El expediente de inspección\n");
    const exp = (await expedienteDeNorma(A.id, "NOM-002-STPS", { desde: hace(365), hasta: AHORA }, AHORA))!;
    revisar("trae las órdenes cerradas del periodo", exp.ordenes.length === 2, exp.ordenes.map((o) => o.number));
    revisar("dice cuáles obligaciones quedaron sin respaldo, en vez de esconderlo",
      Array.isArray(exp.sinRespaldo), exp.sinRespaldo);
    const vacio = (await expedienteDeNorma(A.id, "NOM-002-STPS", { desde: hace(365), hasta: hace(300) }, AHORA))!;
    revisar("un periodo sin nada devuelve vacío, no inventa", vacio.ordenes.length === 0);
    revisar("una norma que no tiene no devuelve nada", (await expedienteDeNorma(A.id, "NOM-020-STPS", { desde: hace(365), hasta: AHORA }, AHORA)) === null);

    console.log("\n10. Cuando el catálogo cambia\n");
    revisar("recién adoptada, nada cambió", (await normasQueCambiaron(A.id)).length === 0);
    // Se simula una version nueva bajandole la version a la adoptada.
    await prisma.normaAdoptada.update({ where: { id: norma.id }, data: { versionAdoptada: 0 } });
    const cambiaron = await normasQueCambiaron(A.id);
    revisar("si el catálogo va más adelante, lo dice", cambiaron.length === 1 && cambiaron[0].clave === "NOM-002-STPS", cambiaron);
    revisar("y la norma leída lo marca", (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!.cambioDesdeQueLaAdopto === true);

    // Se borra una obligacion para ver que la actualizacion la reponga sin
    // tocar lo que el cliente ya tenia amarrado.
    const antesDeActualizar = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    const amarresAntes = antesDeActualizar.obligaciones.flatMap((o) => o.amarres).length;
    await prisma.obligacionAdoptada.deleteMany({ where: { normaId: norma.id, clave: "sistemas-fijos" } });
    const act = await actualizarDesdeCatalogo(A.id, norma.id, quien.id);
    revisar("actualizar repone lo que faltaba", act.ok && act.dato.nuevas === 1, act.ok ? act.dato : act.motivos);
    const despues = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!;
    revisar("vuelven a ser tres obligaciones", despues.obligaciones.length === 3);
    revisar("y NO se tiró lo que el cliente ya tenía amarrado",
      despues.obligaciones.flatMap((o) => o.amarres).length === amarresAntes,
      { antes: amarresAntes, despues: despues.obligaciones.flatMap((o) => o.amarres).length });
    revisar("ya no dice que cambió", despues.cambioDesdeQueLaAdopto === false);

    console.log("\n11. Cada empresa ve solo lo suyo\n");
    revisar("la otra empresa no ve ninguna norma", (await listarNormas(B.id, AHORA)).length === 0);
    revisar("esta empresa ve las dos suyas", (await listarNormas(A.id, AHORA)).length === 2);

    console.log("\n12. Quitar un respaldo\n");
    const paraQuitar = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!.obligaciones.find((o) => o.amarres.length)!;
    const cuantos = paraQuitar.amarres.length;
    const quitado = await desamarrar(A.id, paraQuitar.amarres[0].id, quien.id);
    revisar("se quita el respaldo", quitado.ok);
    const trasQuitar = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!.obligaciones.find((o) => o.id === paraQuitar.id)!;
    revisar("queda uno menos", trasQuitar.amarres.length === cuantos - 1);
    revisar("desde otra empresa no se puede quitar", !(await desamarrar(B.id, paraQuitar.amarres[1]?.id ?? "x", quien.id)).ok);

    console.log("\n13. Si se borra el plan, la obligación vuelve a «no se sabe»\n");
    const conSolo = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!.obligaciones.find((o) => o.amarres.some((a) => a.pieza === "plan"));
    if (conSolo) {
      const cuantosAntes = conSolo.amarres.length;
      await prisma.maintenancePlan.delete({ where: { id: planVencido.id } });
      const trasBorrar = (await normaPorClave(A.id, "NOM-002-STPS", AHORA))!.obligaciones.find((o) => o.id === conSolo.id)!;
      revisar("el amarre se fue con el plan, no quedó colgando",
        trasBorrar.amarres.length < cuantosAntes || trasBorrar.amarres.every((a) => a.href !== `/plans/${planVencido.id}`),
        { antes: cuantosAntes, despues: trasBorrar.amarres.length });
    } else {
      revisar("había una obligación con plan amarrado", false);
    }
  } finally {
    await prisma.organization.delete({ where: { id: A.id } });
    await prisma.organization.delete({ where: { id: B.id } });
  }

  console.log(`\n(${TOTAL_OBLIGACIONES} obligaciones en el catálogo)`);
  console.log(fallos === 0 ? "\n✓ Todo pasa\n" : `\n✗ ${fallos} fallas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
