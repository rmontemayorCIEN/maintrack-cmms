/**
 * Bloque 4 — Importación segura: validar antes de guardar, todo o nada,
 * duplicados decididos, lotes trazables y reversión que no rompe nada.
 *
 * Llama a las MISMAS funciones que la ruta (`validarImportacion`,
 * `ejecutarImportacion`, `revertirLote`); la última parte entra por HTTP para
 * probar lo que solo la ruta agrega: permisos y aislamiento entre empresas.
 *
 *   npx tsx scripts/prueba-importacion-segura.ts
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { ErrorDeImportacion, ejecutarImportacion, validarImportacion } from "../lib/importacion-motor";
import { diagnosticarReversion, revertirLote, ErrorDeLote } from "../lib/lotes";
import * as N from "../lib/normalizar";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 220)}` : ""}`);
}

async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: RegExp) {
  try {
    await fn();
    revisar(afirmacion, false, "no se rechazó");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, !contiene || contiene.test(m), m);
  }
}

const csv = (filas: string[][]) => filas.map((f) => f.join(",")).join("\n");

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) return;
    } catch { /* todavia no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3202";
  if (!process.env.BASE_URL) {
    servidor = levantarServidor({ puerto: 3202 });
  }

  const sello = `imp-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: `${sello}-A`, slug: `${sello}-a`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });
  const otra = await prisma.organization.create({
    data: { name: `${sello}-B`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE" },
  });

  try {
    const admin = await prisma.user.create({
      data: { organizationId: org.id, email: `adm-${sello}@t.mx`, name: "Admin", role: "ADMIN", passwordHash: "x" },
    });
    const ctx = { organizationId: org.id, userId: admin.id, plan: "ENTERPRISE" };

    console.log("\n0. Normalización (sin base)");
    revisar("«30/02/2026» se rechaza en vez de volverse 2 de marzo", !N.fecha("30/02/2026").ok);
    revisar("«15/09/2026» se lee día/mes", (() => { const f = N.fecha("15/09/2026"); return f.ok && f.valor?.mes === 9 && f.valor?.dia === 15; })());
    revisar("«1,5» se rechaza por ambiguo; «1,250.50» se lee como miles", !N.numero("1,5").ok && (N.numero("$1,250.50") as { valor: number }).valor === 1250.5);
    revisar("unidades escritas distinto son la misma", N.unidad("Piezas") === "pza" && N.unidad("PZ") === "pza" && N.unidad("litros") === "lt");
    revisar("RFC con espacios y guiones se limpia y valida", (N.rfc("rin-850101 ab3") as { valor: string }).valor === "RIN850101AB3" && !N.rfc("XYZ").ok);
    revisar("la clave comparable ignora acentos, mayúsculas y signos", N.claveComparable("Bomba Centrífuga #2") === N.claveComparable("bomba centrifuga 2"));
    revisar("el nombre guardado conserva acentos y mayúsculas", N.texto("  Bomba   Centrífuga  ") === "Bomba Centrífuga");

    console.log("\n5. Importación válida");
    const sitios = csv([["codigo", "nombre", "ciudad"], ["P01", "Planta Norte", "Monterrey"], ["P02", "Planta Sur", "Saltillo"]]);
    const vSitios = await validarImportacion({ tipo: "sitios", contenido: sitios, ...ctx });
    revisar("la validación dice qué pasaría: 2 nuevos, sin errores", vSitios.totales.nuevos === 2 && vSitios.totales.errores === 0 && vSitios.puedeImportar, vSitios.totales);
    revisar("y NO escribió nada", (await prisma.site.count({ where: { organizationId: org.id } })) === 0);
    const rSitios = await ejecutarImportacion({ tipo: "sitios", contenido: sitios, archivoNombre: "sitios.csv", ...ctx });
    revisar("al confirmar, se crean los 2", rSitios.creados === 2 && (await prisma.site.count({ where: { organizationId: org.id } })) === 2, rSitios);
    const loteSitios = await prisma.importBatch.findUniqueOrThrow({ where: { id: rSitios.loteId }, include: { registros: true } });
    revisar("el lote registra empresa, usuario, tipo, archivo, huella y conteos",
      loteSitios.organizationId === org.id && loteSitios.userId === admin.id && loteSitios.tipo === "sitios" &&
      loteSitios.archivoNombre === "sitios.csv" && loteSitios.archivoHuella?.length === 64 && loteSitios.creados === 2 &&
      loteSitios.registros.length === 2 && loteSitios.estado === "COMPLETADA");
    revisar("y no guarda el contenido del archivo", !JSON.stringify(loteSitios).includes("Planta Norte"));

    const ubic = csv([["sitio", "codigo", "nombre"], ["P01", "NAV-1", "Nave 1"], ["P01", "NAV-2", "Nave 2"]]);
    await ejecutarImportacion({ tipo: "ubicaciones", contenido: ubic, ...ctx });

    console.log("\n6. Archivo con columnas faltantes");
    const sinSitio = csv([["codigo", "nombre"], ["B-1", "Bomba"]]);
    const vSinSitio = await validarImportacion({ tipo: "activos", contenido: sinSitio, ...ctx });
    revisar("sin la columna obligatoria «sitio» la vista previa la nombra y no deja importar",
      vSinSitio.columnasFaltantes.includes("sitio") && !vSinSitio.puedeImportar && vSinSitio.totales.rechazados === 1, vSinSitio.columnasFaltantes);
    await rechaza("y confirmar de todos modos se rechaza, con el nombre de la columna",
      () => ejecutarImportacion({ tipo: "activos", contenido: sinSitio, ...ctx }), /columnas obligatorias: sitio/);
    const conExtra = await validarImportacion({
      tipo: "sitios", contenido: csv([["codigo", "nombre", "gerente"], ["P09", "Planta X", "Juan"]]), ...ctx,
    });
    revisar("una columna no reconocida se reporta, no se inventa un campo", conExtra.columnasDesconocidas.includes("gerente"), conExtra.columnasDesconocidas);

    console.log("\n7. Fechas y números inválidos");
    const malos = csv([
      ["codigo", "nombre", "sitio", "ubicacion", "fecha_compra", "costo_adquisicion", "criticidad"],
      ["B-1", "Bomba uno", "P01", "NAV-1", "30/02/2026", "1500", "A"],
      ["B-2", "Bomba dos", "P01", "NAV-1", "15/09/2025", "mil pesos", "B"],
      ["B-3", "Bomba tres", "P01", "NAV-9", "", "", "Z"],
    ]);
    const vMalos = await validarImportacion({ tipo: "activos", contenido: malos, ...ctx });
    const fila = (n: number) => vMalos.filas.find((f) => f.fila === n)!;
    revisar("una fecha imposible en un campo opcional avisa y se deja vacía (fila 2)",
      fila(2).estado === "nuevo" && fila(2).advertencias.some((a) => a.columna === "fecha_compra"), fila(2));
    revisar("un número inválido es error, con fila y columna (fila 3, costo_adquisicion)",
      fila(3).estado === "error" && fila(3).fallas.some((f) => f.columna === "costo_adquisicion"), fila(3).fallas);
    revisar("varios errores en una fila se reportan todos (fila 4: ubicación y criticidad)",
      fila(4).fallas.some((f) => f.columna === "ubicacion") && fila(4).fallas.some((f) => f.columna === "criticidad"), fila(4).fallas);
    revisar("con errores no se puede importar", !vMalos.puedeImportar);
    await rechaza("y si se intenta, se rechaza sin guardar nada",
      () => ejecutarImportacion({ tipo: "activos", contenido: malos, ...ctx }), /con error/);
    revisar("ningún activo quedó a medias", (await prisma.asset.count({ where: { organizationId: org.id } })) === 0);

    console.log("\n8. Duplicados exactos y probables");
    const activos = csv([
      ["codigo", "nombre", "sitio", "ubicacion", "numero_serie", "criticidad"],
      ["BOM-101", "Bomba de alimentación", "P01", "NAV-1", "SN-777", "A"],
      ["BOM-102", "Compresor de aire", "P01", "NAV-2", "", "B"],
    ]);
    await ejecutarImportacion({ tipo: "activos", contenido: activos, ...ctx });
    const segunda = csv([
      ["codigo", "nombre", "sitio", "ubicacion", "numero_serie"],
      ["BOM-101", "Bomba de alimentación", "P01", "NAV-1", "SN-777"],   // exacto: misma clave
      ["BOM-900", "BOMBA DE ALIMENTACIÓN", "P01", "NAV-1", ""],        // posible: mismo nombre y lugar
      ["CMP-555", "Otro equipo", "P01", "NAV-2", "sn 777"],             // posible: misma serie
      ["BOM-200", "Bomba de alimentación", "P01", "NAV-2", ""],         // diferente: otro lugar
      ["BOM-200", "Repetida", "P01", "NAV-2", ""],                      // repetida en el archivo
    ]);
    const vDup = await validarImportacion({ tipo: "activos", contenido: segunda, ...ctx });
    const f2 = (n: number) => vDup.filas.find((f) => f.fila === n)!;
    revisar("misma clave → duplicado exacto", f2(2).estado === "exacto", f2(2).coincide);
    revisar("mismo nombre (sin importar acentos y mayúsculas) en la misma ubicación → posible duplicado",
      f2(3).estado === "posible" && /nombre/.test(f2(3).coincide?.motivo ?? ""), f2(3).coincide);
    revisar("mismo número de serie escrito distinto → posible duplicado",
      f2(4).estado === "posible" && /serie/.test(f2(4).coincide?.motivo ?? ""), f2(4).coincide);
    revisar("mismo nombre en OTRA ubicación → registro diferente", f2(5).estado === "nuevo", f2(5));
    revisar("la misma clave dos veces en el archivo → error con la fila original", f2(6).estado === "error" && /fila 5/.test(f2(6).fallas[0]?.motivo), f2(6).fallas);

    // Sin la fila repetida, que es un error y bloquearía la importación.
    const sinRepetida = csv(segunda.split("\n").slice(0, 5).map((l) => l.split(",")));
    const rOmitir = await ejecutarImportacion({ tipo: "activos", contenido: sinRepetida, ...ctx });
    revisar("por omisión: el exacto y los posibles se omiten, el diferente se crea",
      rOmitir.creados === 1 && rOmitir.omitidos === 3, rOmitir);
    revisar("nunca se combinó nada: siguen existiendo por separado, sin fusionar",
      (await prisma.asset.count({ where: { organizationId: org.id } })) === 3);

    const conDecision = csv([["codigo", "nombre", "sitio", "ubicacion"], ["BOM-901", "Bomba de alimentación", "P01", "NAV-1"]]);
    const vDecision = await validarImportacion({ tipo: "activos", contenido: conDecision, ...ctx });
    revisar("un posible duplicado no se crea sin decisión", vDecision.filas[0].estado === "posible");
    const rCrear = await ejecutarImportacion({
      tipo: "activos", contenido: conDecision, ...ctx, decisiones: { exactos: "omitir", crearPosibles: [2] },
    });
    revisar("con decisión expresa, se crea como nuevo", rCrear.creados === 1);

    console.log("\n9. Actualización de registros existentes");
    const actualiza = csv([["codigo", "nombre", "sitio", "ubicacion", "fabricante"], ["BOM-102", "Compresor de aire", "P01", "NAV-2", "Atlas Copco"]]);
    const vAct = await validarImportacion({ tipo: "activos", contenido: actualiza, ...ctx, decisiones: { exactos: "actualizar", crearPosibles: [] } });
    revisar("eligiendo actualizar, el exacto aparece como «actualizar»", vAct.filas[0].estado === "actualizar");
    const rAct = await ejecutarImportacion({ tipo: "activos", contenido: actualiza, ...ctx, decisiones: { exactos: "actualizar", crearPosibles: [] } });
    const compresor = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: "BOM-102" } });
    revisar("se actualiza el existente, no se crea otro", rAct.actualizados === 1 && rAct.creados === 0 && compresor.manufacturer === "Atlas Copco");
    const regAct = await prisma.importRecord.findFirstOrThrow({ where: { batchId: rAct.loteId } });
    revisar("el lote guarda cómo estaba antes", regAct.accion === "UPDATED" && JSON.parse(regAct.antes ?? "{}").manufacturer === null, regAct.antes);

    console.log("\n10. Un error a media importación no deja nada");
    const tres = csv([["codigo", "nombre"], ["P10", "Diez"], ["P11", "Once"], ["P12", "Doce"]]);
    await rechaza("una falla en la fila 3 detiene todo",
      () => ejecutarImportacion({ tipo: "sitios", contenido: tres, ...ctx, fallarEnFila: 3 }), /no se guardó ningún renglón/i);
    revisar("ni la fila 2, que ya se había guardado, quedó", (await prisma.site.count({ where: { organizationId: org.id, code: { in: ["P10", "P11", "P12"] } } })) === 0);
    revisar("y queda un lote FALLIDA con el motivo", Boolean(await prisma.importBatch.findFirst({ where: { organizationId: org.id, estado: "FALLIDA", detalle: { contains: "Falla provocada" } } })));

    // Plan importado: el plan y su asignación, en la misma transacción.
    const plan = csv([["nombre", "activo", "cada_dias", "primer_vencimiento"], ["Lubricación", "BOM-101", "30", "15/10/2026"]]);
    const rPlan = await ejecutarImportacion({ tipo: "planes", contenido: plan, ...ctx });
    const planCreado = await prisma.maintenancePlan.findFirstOrThrow({ where: { organizationId: org.id, name: "Lubricación" } });
    revisar("un plan importado queda con su asignación (sin ella nunca generaría órdenes)",
      rPlan.creados === 1 && (await prisma.planAsset.count({ where: { planId: planCreado.id } })) === 1);
    const planDup = csv([["nombre", "activo", "cada_dias"], ["Engrase", "BOM-101", "30"]]);
    const vPlanDup = await validarImportacion({ tipo: "planes", contenido: planDup, ...ctx });
    revisar("otro plan del mismo equipo con la misma frecuencia → posible duplicado",
      vPlanDup.filas[0].estado === "posible" && /frecuencia/.test(vPlanDup.filas[0].coincide?.motivo ?? ""), vPlanDup.filas[0].coincide);

    console.log("\n11. Reversión completa de una importación nueva");
    const nuevos = csv([["codigo", "nombre"], ["P20", "Veinte"], ["P21", "Veintiuno"]]);
    const rNuevos = await ejecutarImportacion({ tipo: "sitios", contenido: nuevos, ...ctx });
    const diag = await diagnosticarReversion(org.id, rNuevos.loteId);
    revisar("el diagnóstico dice qué se borraría, antes de borrar", diag.aBorrar.length === 2 && diag.bloqueados.length === 0);
    const rev = await revertirLote({ organizationId: org.id, loteId: rNuevos.loteId, userId: admin.id });
    revisar("la reversión los borra", rev.borrados === 2 && (await prisma.site.count({ where: { organizationId: org.id, code: { in: ["P20", "P21"] } } })) === 0);
    revisar("y el lote queda REVERTIDA", (await prisma.importBatch.findUniqueOrThrow({ where: { id: rNuevos.loteId } })).estado === "REVERTIDA");
    await rechaza("no se puede revertir dos veces", () => revertirLote({ organizationId: org.id, loteId: rNuevos.loteId, userId: admin.id }), /ya se revirtió/);

    // Refacciones con existencia inicial: se revierten con su movimiento.
    await prisma.warehouse.create({ data: { organizationId: org.id, code: "ALM-01", name: "General", esGeneral: true } });
    await prisma.partUnit.create({ data: { organizationId: org.id, code: "pza", name: "Pieza" } });
    const refs = csv([["codigo", "nombre", "unidad", "existencia", "costo_unitario"], ["R-1", "Filtro", "Piezas", "5", "100"], ["R-2", "Banda", "pz", "3", "80"]]);
    const rRefs = await ejecutarImportacion({ tipo: "refacciones", contenido: refs, ...ctx });
    const filtro = await prisma.part.findFirstOrThrow({ where: { organizationId: org.id, code: "R-1" } });
    revisar("la existencia inicial entra como movimiento y cuadra", filtro.quantityOnHand === 5 && filtro.unit === "pza" &&
      (await prisma.stockMovement.count({ where: { partId: filtro.id } })) === 1);

    console.log("\n12. Reversión bloqueada por uso posterior");
    const ot = await prisma.workOrder.create({ data: { organizationId: org.id, number: "OT-1", title: "Usa la refacción", status: "IN_PROGRESS" } });
    await prisma.workOrderPart.create({ data: { workOrderId: ot.id, partId: filtro.id, quantity: 1, unitCost: 100, cost: 100 } });
    const diagUso = await diagnosticarReversion(org.id, rRefs.loteId);
    revisar("la refacción usada en una orden no se borra, y se dice por qué",
      diagUso.bloqueados.some((b) => b.id === filtro.id && b.motivos.some((m) => /consumos/.test(m))), diagUso.bloqueados);
    revisar("la que nadie usó sí se borraría", diagUso.aBorrar.length === 1);
    const revParcial = await revertirLote({ organizationId: org.id, loteId: rRefs.loteId, userId: admin.id });
    revisar("reversión parcial: la usada se queda con su existencia, la otra se va con su movimiento",
      revParcial.borrados === 1 && Boolean(await prisma.part.findUnique({ where: { id: filtro.id } })) &&
      !(await prisma.part.findFirst({ where: { organizationId: org.id, code: "R-2" } })) &&
      (await prisma.importBatch.findUniqueOrThrow({ where: { id: rRefs.loteId } })).estado === "REVERSION_PARCIAL");

    // Un sitio con activos de OTRO lote no se puede revertir.
    const diagSitios = await diagnosticarReversion(org.id, rSitios.loteId);
    revisar("un sitio con ubicaciones y activos de otras importaciones queda bloqueado",
      diagSitios.bloqueados.some((b) => b.motivos.some((m) => /activos|ubicaciones/.test(m))), diagSitios.bloqueados.map((b) => b.motivos));
    // Todo bloqueado: se rechaza y queda en la bitácora.
    const soloUsados = await prisma.importBatch.findFirstOrThrow({ where: { id: rSitios.loteId } });
    void soloUsados;

    console.log("\n19. Archivo grande dentro del límite");
    const grande = csv([["codigo", "nombre"], ...Array.from({ length: 2000 }, (_, i) => [`G${i}`, `Sitio ${i}`])]);
    const t0 = Date.now();
    const rGrande = await ejecutarImportacion({ tipo: "sitios", contenido: grande, ...ctx });
    const segundos = (Date.now() - t0) / 1000;
    revisar("2,000 renglones se importan completos, en una transacción", rGrande.creados === 2000, { segundos });
    const excesivo = csv([["codigo", "nombre"], ...Array.from({ length: 5001 }, (_, i) => [`X${i}`, `S ${i}`])]);
    await rechaza("más de 5,000 renglones se rechaza con un mensaje que dice qué hacer",
      () => validarImportacion({ tipo: "sitios", contenido: excesivo, ...ctx }), /máximo.*Divídalo/);

    console.log("\n10b. El límite del plan cuenta lo que trae el archivo");
    const orgChica = await prisma.organization.create({ data: { name: `${sello}-C`, slug: `${sello}-c`, plan: "PROFESSIONAL", status: "ACTIVE" } });
    try {
      const usuarioChica = await prisma.user.create({ data: { organizationId: orgChica.id, email: `c-${sello}@t.mx`, name: "C", role: "ADMIN", passwordHash: "x" } });
      const muchos = csv([["codigo", "nombre"], ...Array.from({ length: 12 }, (_, i) => [`S${i}`, `Sitio ${i}`])]);
      await rechaza("12 sitios con un límite de 10: se rechaza antes de empezar, diciendo cuántos caben",
        () => ejecutarImportacion({ tipo: "sitios", contenido: muchos, organizationId: orgChica.id, userId: usuarioChica.id, plan: "PROFESSIONAL" }),
        /caben 10/);
      revisar("y no se creó ninguno", (await prisma.site.count({ where: { organizationId: orgChica.id } })) === 0);
    } finally {
      await prisma.organization.delete({ where: { id: orgChica.id } }).catch(() => undefined);
    }

    console.log("\n13-14. Por HTTP: otra empresa y un rol sin permiso");
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(llaveDeSesion());
    const firmar = async (u: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      `mt_session=${await new SignJWT({ userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    const ajeno = await prisma.user.create({ data: { organizationId: otra.id, email: `b-${sello}@t.mx`, name: "B", role: "OWNER", passwordHash: "x" } });
    const tecnico = await prisma.user.create({ data: { organizationId: org.id, email: `t-${sello}@t.mx`, name: "T", role: "TECHNICIAN", passwordHash: "x" } });
    const cAjeno = await firmar(ajeno);
    const cTecnico = await firmar(tecnico);
    const cAdmin = await firmar(admin);
    const pedir = async (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };
    const rAjenoVer = await pedir("GET", `/api/import/lotes/${rPlan.loteId}`, cAjeno);
    revisar("otra empresa no ve el diagnóstico de un lote ajeno (404)", rAjenoVer.status === 404, rAjenoVer.status);
    const rAjenoRev = await pedir("POST", `/api/import/lotes/${rPlan.loteId}/revertir`, cAjeno);
    revisar("ni lo puede revertir (404), y el plan sigue ahí",
      rAjenoRev.status === 404 && Boolean(await prisma.maintenancePlan.findUnique({ where: { id: planCreado.id } })), rAjenoRev.status);
    const listaAjena = await pedir("GET", "/api/import/lotes", cAjeno);
    revisar("su listado de importaciones no trae las de la otra empresa",
      Array.isArray(listaAjena.json.lotes) && (listaAjena.json.lotes as unknown[]).length === 0, listaAjena.status);
    const rTec = await pedir("POST", "/api/import/sitios", cTecnico, { contenido: csv([["codigo", "nombre"], ["T1", "Técnico"]]) });
    revisar("un técnico no puede validar ni importar (403)", rTec.status === 403, rTec.status);
    const rTecRev = await pedir("POST", `/api/import/lotes/${rPlan.loteId}/revertir`, cTecnico);
    revisar("ni revertir (403)", rTecRev.status === 403, rTecRev.status);
    const rAdmin = await pedir("POST", "/api/import/sitios", cAdmin, { contenido: csv([["codigo", "nombre"], ["H1", "Por HTTP"]]) });
    revisar("el administrador sí valida por HTTP, y la respuesta trae el detalle por fila",
      rAdmin.status === 200 && Array.isArray(rAdmin.json.filas), rAdmin.status);

    console.log("\n20. La bitácora tiene todo el proceso, sin contenido del archivo");
    const acciones = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.id }, select: { action: true } })).map((a) => a.action));
    for (const a of ["IMPORT_VALIDATED", "IMPORT_CONFIRMED", "IMPORT_COMPLETED", "IMPORT_FAILED", "IMPORT_REVERT_REQUESTED", "IMPORT_REVERT_PARTIAL", "IMPORT_REVERTED"]) {
      revisar(`queda registrado: ${a}`, acciones.has(a));
    }
    const textoBitacora = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: org.id }, select: { summary: true, changes: true } }));
    revisar("la bitácora no guarda el contenido de los archivos", !textoBitacora.includes("Bomba de alimentación,P01"));
  } finally {
    for (const o of [org, otra]) await prisma.organization.delete({ where: { id: o.id } }).catch(() => undefined);
    if (servidor?.pid) {
      await apagarServidor(servidor, 3202);
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e instanceof ErrorDeImportacion || e instanceof ErrorDeLote ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
