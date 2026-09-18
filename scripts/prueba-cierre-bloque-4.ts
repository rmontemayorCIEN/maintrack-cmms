/**
 * Cierre del Bloque 4: Excel y CSV por las mismas reglas, historial con
 * estados, reversión segura de los importadores nuevos (usuarios, almacenes,
 * medidores, lecturas, existencias), las tres maneras de crear una empresa,
 * la eliminación controlada de la demostración, el estado operativo aparte del
 * comercial y la cobertura preventiva sin contradicciones.
 *
 * Complementa a `prueba-importacion-segura.ts` (CSV, duplicados, falla a media
 * carga, reversión de sitios y refacciones) y `prueba-puesta-en-marcha.ts`
 * (avance y porcentaje). Llama a las MISMAS funciones que las rutas; la última
 * parte entra por HTTP para permisos, aislamiento y el alta del operador.
 *
 * Todo en empresas creadas aquí y borradas al final. Al terminar compara las
 * demás empresas contra como estaban: esta prueba no toca ninguna otra.
 *
 *   npx tsx scripts/prueba-cierre-bloque-4.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { ErrorDeImportacion, ejecutarImportacion, validarImportacion, type Archivo } from "../lib/importacion-motor";
import { REFERENCIA_EXISTENCIA_INICIAL } from "../lib/importacion";
import { ErrorDeLote, REFERENCIA_REVERSION, diagnosticarReversion, revertirLote } from "../lib/lotes";
import { escribirXlsx } from "../lib/xlsx";
import { emitirRestablecimiento, usarRestablecimiento } from "../lib/acceso";
import { aplicarMovimiento } from "../lib/almacen";
import { iniciarEmpresa, quitarDemo, vistaPreviaQuitarDemo, MARCA_DEMO } from "../lib/demo";
import { catalogosIndispensables, catalogosPara, sitioInicialPara } from "../lib/catalogos-estandar";
import { puestaEnMarcha } from "../lib/puesta-en-marcha";
import { comenzarAOperar } from "../lib/puesta-en-marcha-acciones";
import { asignarPlan } from "../lib/asignaciones";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
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

const csv = (filas: string[][]): Archivo => ({ formato: "csv", contenido: filas.map((f) => f.join(",")).join("\n"), nombre: "archivo.csv" });
const xlsx = (filas: string[][], nombre = "archivo.xlsx"): Archivo =>
  ({ formato: "xlsx", contenido: escribirXlsx(filas[0], filas.slice(1)).toString("base64"), nombre });

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

/** Una foto de las empresas que NO son de esta prueba, para comprobar que no se tocaron. */
async function fotoAjena(excluir: () => string[]) {
  const where = { organizationId: { notIn: excluir() } };
  const [orgs, sitios, activos, usuarios, lotes, movimientos, lecturas, auditoria] = await Promise.all([
    prisma.organization.findMany({ where: { id: { notIn: excluir() } }, select: { id: true, status: true, operandoDesde: true }, orderBy: { id: "asc" } }),
    prisma.site.count({ where }), prisma.asset.count({ where }), prisma.user.count({ where }),
    prisma.importBatch.count({ where }), prisma.stockMovement.count({ where }), prisma.meterReading.count({ where }),
    prisma.auditLog.count({ where }),
  ]);
  return JSON.stringify({ orgs, sitios, activos, usuarios, lotes, movimientos, lecturas, auditoria });
}

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3203";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3203", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `b4c-${Date.now()}`;
  const creadas: string[] = [];
  const antes = await fotoAjena(() => creadas);

  const nuevaOrg = async (sufijo: string, datos: Record<string, unknown> = {}) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${sufijo}`, slug: `${sello}-${sufijo}`.toLowerCase(), plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", ...datos },
    });
    creadas.push(o.id);
    return o;
  };

  try {
    const org = await nuevaOrg("imp", { tipoInstalacion: "PLANTA" });
    const otra = await nuevaOrg("otra");
    const admin = await prisma.user.create({ data: { organizationId: org.id, email: `adm-${sello}@t.mx`, name: "Admin", role: "ADMIN", passwordHash: "x" } });
    const ctx = { organizationId: org.id, userId: admin.id, plan: "ENTERPRISE" };
    await iniciarEmpresa({ organizationId: org.id, userId: admin.id, modo: "RECOMENDADA" });
    const sitio = await prisma.site.findFirstOrThrow({ where: { organizationId: org.id } });
    await prisma.site.update({ where: { id: sitio.id }, data: { code: "P01" } });
    await prisma.location.create({ data: { organizationId: org.id, siteId: sitio.id, code: "NAV-1", name: "Nave 1" } });

    // ───────────────────────────────────────────────────────── 1-2
    console.log("\n1-2. CSV y Excel válidos, por las mismas reglas");
    const filasActivos = [["codigo", "nombre", "sitio", "ubicacion", "fecha_compra", "costo_adquisicion"], ["XL-1", "Bomba", "P01", "NAV-1", "11/09/2023", "95000.5"]];
    const vCsv = await validarImportacion({ tipo: "activos", archivo: csv(filasActivos), ...ctx });
    const vXlsx = await validarImportacion({ tipo: "activos", archivo: xlsx(filasActivos), ...ctx });
    revisar("el mismo contenido en CSV y en Excel da la misma vista previa",
      JSON.stringify(vCsv.totales) === JSON.stringify(vXlsx.totales) && JSON.stringify(vCsv.filas) === JSON.stringify(vXlsx.filas), { csv: vCsv.totales, xlsx: vXlsx.totales });
    revisar("la vista previa trae los diez conteos que pide la pantalla",
      ["leidos", "validos", "conAdvertencias", "rechazados", "nuevos", "actualizar", "exactos", "posibles"].every((k) => k in vXlsx.totales) &&
      Array.isArray(vXlsx.columnasDesconocidas) && Array.isArray(vXlsx.columnasFaltantes));
    revisar("validar no creó ningún activo", (await prisma.asset.count({ where: { organizationId: org.id } })) === 0);
    revisar("pero dejó la entrada «validada» en el historial, sin contenido del archivo",
      (await prisma.importBatch.count({ where: { organizationId: org.id, estado: "VALIDADA", tipo: "activos" } })) === 2);

    // Un Excel real, con hojas en otro orden, cadenas compartidas y fechas como número.
    const fixture = readFileSync("scripts/fixtures/activos-estilo-excel.xlsx").toString("base64");
    const rFixture = await ejecutarImportacion({ tipo: "activos", archivo: { formato: "xlsx", contenido: fixture, nombre: "activos-estilo-excel.xlsx" }, ...ctx });
    const xl1 = await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: "XL-1" } });
    revisar("un archivo guardado por Excel se importa: fecha de celda de fecha, número con decimales, texto con formato",
      rFixture.creados === 2 && xl1.name === "Bomba centrífuga & motor" && xl1.purchaseCost === 95000.5 &&
      xl1.purchaseDate?.toISOString().startsWith("2023-09-1") === true, { creados: rFixture.creados, fecha: xl1.purchaseDate, costo: xl1.purchaseCost });
    const loteXl = await prisma.importBatch.findUniqueOrThrow({ where: { id: rFixture.loteId } });
    // XL-2 viene sin ubicación: se crea, con advertencia, y el lote lo dice.
    revisar("el lote del Excel queda «completada con advertencias», con nombre y huella", loteXl.estado === "COMPLETADA_CON_ADVERTENCIAS" && loteXl.archivoNombre === "activos-estilo-excel.xlsx" && loteXl.archivoHuella?.length === 64, loteXl.estado);
    await rechaza("un archivo que no es Excel se rechaza con un mensaje que dice qué hacer",
      () => validarImportacion({ tipo: "activos", archivo: { formato: "xlsx", contenido: Buffer.from("no soy un zip").toString("base64") }, ...ctx }), /xlsx|Excel/i);

    // ───────────────────────────────────────────────────────── 3-8
    console.log("\n3-8. Errores con fila, columna, valor y solución — también desde Excel");
    const vFaltan = await validarImportacion({ tipo: "activos", archivo: xlsx([["codigo", "nombre"], ["X", "Y"]]), ...ctx });
    revisar("3. columna obligatoria faltante: se nombra y no deja importar", vFaltan.columnasFaltantes.join() === "sitio" && !vFaltan.puedeImportar, vFaltan.columnasFaltantes);
    const malos = xlsx([
      ["codigo", "nombre", "sitio", "fecha_compra", "costo_adquisicion"],
      ["M-1", "Uno", "P01", "31/02/2024", "100"],      // 4. fecha que no existe
      ["M-2", "Dos", "P01", "", "1,5"],                // 5. costo ambiguo
      ["M-3", "Tres", "P01", "", ""],
      ["M-3", "Tres bis", "P01", "", ""],              // 6. repetido en el archivo
      ["XL-2", "Compresor", "P01", "", ""],            // 7. ya existe
      ["M-9", "bomba centrifuga & MOTOR", "P01", "", ""], // 8. posible: mismo nombre sin ubicación → otro ámbito
    ]);
    const vMalos = await validarImportacion({ tipo: "activos", archivo: malos, ...ctx });
    const fila = (n: number) => vMalos.filas.find((f) => f.fila === n)!;
    // La fecha de compra es opcional: mal escrita se avisa y se deja vacía,
    // no se inventa otra. En una columna obligatoria es rechazo (ver lecturas).
    const fFecha = [...fila(2).fallas, ...fila(2).advertencias].find((x) => x.columna === "fecha_compra");
    revisar("4. fecha inválida: fila, columna, valor recibido, problema y cómo corregirlo",
      fFecha?.columna === "fecha_compra" && fFecha.valor === "31/02/2024" && Boolean(fFecha.motivo) && Boolean(fFecha.solucion), fFecha);
    const fCosto = fila(3).fallas[0] ?? fila(3).advertencias[0];
    revisar("5. costo ambiguo «1,5»: se señala con su valor y su solución", fCosto?.columna === "costo_adquisicion" && fCosto.valor === "1,5" && Boolean(fCosto.solucion), fCosto);
    revisar("6. código repetido dentro del archivo: error que apunta a la fila original",
      fila(5).estado === "error" && /fila 4/.test(fila(5).fallas[0].motivo) && Boolean(fila(5).fallas[0].solucion), fila(5).fallas);
    revisar("7. duplicado contra la base: exacto", fila(6).estado === "exacto", fila(6).coincide);
    const vPosible = await validarImportacion({
      tipo: "activos", archivo: xlsx([["codigo", "nombre", "sitio", "ubicacion"], ["M-8", "BOMBA CENTRÍFUGA & motor", "P01", "NAV-1"]]), ...ctx,
    });
    revisar("8. posible duplicado por nombre (sin acentos ni mayúsculas, mismo lugar)", vPosible.filas[0].estado === "posible", vPosible.filas[0].coincide);
    revisar("con rechazados no se puede confirmar, y la política se dice antes", !vMalos.puedeImportar && /no se importa nada/.test(vMalos.politica));
    await rechaza("confirmar de todos modos falla y deja el lote como fallido",
      () => ejecutarImportacion({ tipo: "activos", archivo: malos, ...ctx }), /renglón\(es\) con error/);
    const fallida = await prisma.importBatch.findFirst({ where: { organizationId: org.id, estado: "FALLIDA", tipo: "activos" } });
    revisar("el lote fallido guarda los errores (fila y columna), no el archivo",
      Boolean(fallida) && JSON.parse(fallida!.detalle).errores?.some((e: { fila: number; columna: string }) => e.fila === 3 && e.columna === "costo_adquisicion") &&
      !fallida!.detalle.includes("Tres bis"), fallida?.detalle.slice(0, 160));

    // ───────────────────────────────────────────────────────── 9
    console.log("\n9. Actualización de un registro existente desde Excel");
    const rAct = await ejecutarImportacion({
      tipo: "activos", archivo: xlsx([["codigo", "nombre", "sitio", "fabricante"], ["XL-2", "Compresor", "P01", "Kaeser"]]), ...ctx,
      decisiones: { exactos: "actualizar", crearPosibles: [] },
    });
    revisar("se actualiza, no se duplica", rAct.actualizados === 1 && rAct.creados === 0 &&
      (await prisma.asset.findFirstOrThrow({ where: { organizationId: org.id, code: "XL-2" } })).manufacturer === "Kaeser");

    // ───────────────────────────────────────────────────────── 10
    console.log("\n10. Falla a media importación: nada parcial, ningún folio consumido");
    const foliosAntes = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    await rechaza("una falla en la fila 3 de un Excel detiene todo",
      () => ejecutarImportacion({ tipo: "activos", archivo: xlsx([["codigo", "nombre", "sitio"], ["F-1", "A", "P01"], ["F-2", "B", "P01"]]), ...ctx, fallarEnFila: 3 }),
      /no se guardó ningún renglón/i);
    revisar("ni la fila 2 quedó", (await prisma.asset.count({ where: { organizationId: org.id, code: { in: ["F-1", "F-2"] } } })) === 0);
    revisar("la empresa quedó igual (ningún consecutivo avanzó)",
      JSON.stringify(foliosAntes) === JSON.stringify(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })));

    // ───────────────────────────────────────────────────────── 16
    console.log("\n16. Usuarios sin contraseñas");
    const filasUsuarios = [
      ["nombre", "correo", "rol", "puesto", "tarifa_hora", "estado", "contrasena"],
      ["Laura Cisneros", `laura-${sello}@t.mx`, "técnico", "Electromecánica", "180", "activo", "Secreta123"],
      ["Pedro Ruiz", `pedro-${sello}@t.mx`, "supervisor", "", "220", "", "OtraClave9"],
    ];
    const vUsr = await validarImportacion({ tipo: "usuarios", archivo: xlsx(filasUsuarios), ...ctx });
    revisar("la columna de contraseña se avisa y se ignora", vUsr.avisosArchivo.some((a) => /contrasena/.test(a)) && vUsr.puedeImportar, vUsr.avisosArchivo);
    const rUsr = await ejecutarImportacion({ tipo: "usuarios", archivo: xlsx(filasUsuarios), ...ctx });
    const laura = await prisma.user.findUniqueOrThrow({ where: { email: `laura-${sello}@t.mx` } });
    revisar("se crean con rol, puesto y tarifa", rUsr.creados === 2 && laura.role === "TECHNICIAN" && laura.hourlyRate === 180 && laura.jobTitle === "Electromecánica" && laura.organizationId === org.id);
    revisar("la contraseña del archivo NO sirve para entrar", !(await bcrypt.compare("Secreta123", laura.passwordHash)));
    revisar("y la respuesta dice cómo darles acceso", /liga/.test(rUsr.despues ?? ""), rUsr.despues);
    const liga = await emitirRestablecimiento({ organizationId: org.id, userId: laura.id, emitidoPorId: admin.id });
    await usarRestablecimiento(liga.token, "NuevaClaveSegura1");
    revisar("con la liga de un solo uso que ya existía, ella elige la suya",
      await bcrypt.compare("NuevaClaveSegura1", (await prisma.user.findUniqueOrThrow({ where: { id: laura.id } })).passwordHash));
    const ajenoCorreo = await prisma.user.create({ data: { organizationId: otra.id, email: `ajeno-${sello}@t.mx`, name: "Ajeno", role: "ADMIN", passwordHash: "x" } });
    const vAjeno = await validarImportacion({
      tipo: "usuarios", archivo: csv([["nombre", "correo", "rol"], ["X", ajenoCorreo.email, "técnico"], ["Y", `y-${sello}@t.mx`, "propietario"]]), ...ctx,
    });
    revisar("un correo de otra empresa se rechaza sin decir de cuál",
      vAjeno.filas[0].estado === "error" && !JSON.stringify(vAjeno.filas[0]).includes(otra.name), vAjeno.filas[0].fallas);
    revisar("el rol propietario no se importa", vAjeno.filas[1].estado === "error" && vAjeno.filas[1].fallas[0].columna === "rol");
    const bitacoraUsuarios = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: org.id } }));
    revisar("ninguna contraseña del archivo llega a la bitácora", !bitacoraUsuarios.includes("Secreta123") && !bitacoraUsuarios.includes("OtraClave9"));

    // ───────────────────────────────────────────────────────── 17
    console.log("\n17. Almacenes y existencias iniciales");
    const rAlm = await ejecutarImportacion({
      tipo: "almacenes", archivo: xlsx([["codigo", "nombre", "sitio", "responsable", "estado"], ["ALM-02", "Almacén de línea", "P01", `pedro-${sello}@t.mx`, "activo"]]), ...ctx,
    });
    const alm2 = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: org.id, code: "ALM-02" } });
    revisar("el almacén se crea con su sitio y responsable", rAlm.creados === 1 && alm2.siteId === sitio.id && Boolean(alm2.responsableId));
    const vAlmMal = await validarImportacion({ tipo: "almacenes", archivo: csv([["codigo", "nombre", "responsable"], ["ALM-03", "X", "nadie@t.mx"]]), ...ctx });
    revisar("un responsable que no existe se rechaza con cómo corregirlo", vAlmMal.filas[0].estado === "error" && Boolean(vAlmMal.filas[0].fallas[0].solucion));
    await prisma.part.createMany({
      data: [
        { organizationId: org.id, code: "ROD-1", name: "Rodamiento", unit: "pza", unitCost: 300 },
        { organizationId: org.id, code: "ROD-2", name: "Retén", unit: "pza", unitCost: 50 },
      ],
    });
    const vExMal = await validarImportacion({
      tipo: "existencias", archivo: xlsx([["refaccion", "almacen", "cantidad", "costo_unitario", "unidad"], ["ROD-1", "ALM-02", "-3", "", ""], ["ROD-2", "ALM-02", "5", "", "kg"]]), ...ctx,
    });
    revisar("cantidad negativa y unidad distinta se rechazan", vExMal.filas.every((f) => f.estado === "error"), vExMal.filas.map((f) => f.fallas[0]?.motivo));
    const rEx = await ejecutarImportacion({
      tipo: "existencias", archivo: xlsx([["refaccion", "almacen", "cantidad", "costo_unitario", "unidad"], ["ROD-1", "ALM-02", "10", "310", "pza"], ["ROD-2", "ALM-02", "4", "", ""]]), ...ctx,
    });
    const mov1 = await prisma.stockMovement.findFirstOrThrow({ where: { organizationId: org.id, part: { code: "ROD-1" }, reference: REFERENCIA_EXISTENCIA_INICIAL } });
    const rod1 = await prisma.part.findFirstOrThrow({ where: { organizationId: org.id, code: "ROD-1" } });
    revisar("cada existencia entra al kardex como movimiento con su costo, y cuadra",
      rEx.creados === 2 && mov1.movementType === "IN" && mov1.quantity === 10 && mov1.unitCost === 310 && mov1.userId === admin.id &&
      rod1.quantityOnHand === 10 && (await prisma.partStock.findFirstOrThrow({ where: { partId: rod1.id, warehouseId: alm2.id } })).quantity === 10);

    // ───────────────────────────────────────────────────────── 18
    console.log("\n18. Medidores y lecturas: válidas e inválidas");
    const vMedMal = await validarImportacion({
      tipo: "medidores", archivo: csv([["activo", "nombre", "unidad", "lectura_inicial", "fecha_lectura"], ["XL-1", "Horómetro", "h", "-5", "01/09/2026"], ["NO-EXISTE", "H", "h", "10", ""]]), ...ctx,
    });
    revisar("lectura inicial negativa y activo inexistente se rechazan", vMedMal.filas.every((f) => f.estado === "error"), vMedMal.filas.map((f) => f.fallas[0]?.motivo));
    const rMed = await ejecutarImportacion({
      tipo: "medidores", archivo: xlsx([["activo", "nombre", "unidad", "lectura_inicial", "fecha_lectura"], ["XL-1", "Horómetro", "h", "1000", "01/09/2026"]]), ...ctx,
    });
    const medidor = await prisma.meter.findFirstOrThrow({ where: { organizationId: org.id, assetId: xl1.id } });
    revisar("el medidor queda con su tipo y su lectura inicial formal", rMed.creados === 1 && medidor.tipo === "HOROMETRO" && medidor.valorInicial === 1000 && medidor.currentValue === 1000, medidor);
    const vLecMal = await validarImportacion({
      tipo: "lecturas",
      archivo: csv([["activo", "medidor", "valor", "fecha"], ["XL-1", "Horómetro", "900", "05/09/2026"], ["XL-1", "Horómetro", "2000", "02/09/2026"]]), ...ctx,
    });
    revisar("una lectura menor que la inicial se rechaza", vLecMal.filas[0].estado === "error", vLecMal.filas[0].fallas);
    revisar("un horómetro que avanza más horas que las del reloj se rechaza", vLecMal.filas[1].estado === "error", vLecMal.filas[1].fallas);
    const vLecOrden = await validarImportacion({
      tipo: "lecturas",
      archivo: csv([["activo", "medidor", "valor", "fecha"], ["XL-1", "Horómetro", "1030", "03/09/2026"], ["XL-1", "Horómetro", "1020", "04/09/2026"]]), ...ctx,
    });
    const vLecFecha = await validarImportacion({
      tipo: "lecturas", archivo: xlsx([["activo", "medidor", "valor", "fecha"], ["XL-1", "Horómetro", "1010", "31/02/2026"]]), ...ctx,
    });
    const fLec = vLecFecha.filas[0].fallas.find((x) => x.columna === "fecha");
    revisar("4b. una fecha obligatoria que no existe se rechaza con su valor y su solución",
      vLecFecha.filas[0].estado === "error" && fLec?.valor === "31/02/2026" && Boolean(fLec.solucion), fLec);
    revisar("dentro del mismo archivo, una lectura menor que la anterior se rechaza", vLecOrden.filas[0].estado === "nuevo" && vLecOrden.filas[1].estado === "error", vLecOrden.filas.map((f) => f.estado));
    const rLec = await ejecutarImportacion({
      tipo: "lecturas",
      archivo: xlsx([["activo", "medidor", "valor", "fecha"], ["XL-1", "Horómetro", "1030", "03/09/2026"], ["XL-1", "Horómetro", "1060", "05/09/2026"]]), ...ctx,
    });
    revisar("las lecturas válidas entran y el medidor se recalcula",
      rLec.creados === 2 && (await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } })).currentValue === 1060);

    // ───────────────────────────────────────────────────────── 13-15
    console.log("\n13-15. Reversión completa, parcial y bloqueada de los importadores nuevos");
    // Existencias: después de importar, alguien sacó material de ROD-2. Esa ya
    // no se puede compensar; ROD-1 sí.
    await aplicarMovimiento({ organizationId: org.id, partId: (await prisma.part.findFirstOrThrow({ where: { organizationId: org.id, code: "ROD-2" } })).id, warehouseId: alm2.id, tipo: "OUT", cantidad: 1, referencia: "Salida real" });
    const dEx = await diagnosticarReversion(org.id, rEx.loteId);
    revisar("el diagnóstico dice qué se compensa, qué no y por qué, y el resultado esperado",
      dEx.aBorrar.length === 1 && dEx.aBorrar[0].accion === "COMPENSAR" && dEx.bloqueados.length === 1 &&
      /movimientos posteriores/.test(dEx.bloqueados[0].motivos[0]) && dEx.estadoEsperado === "REVERSION_PARCIAL" && Boolean(dEx.resultado), dEx);
    const movAntes = await prisma.stockMovement.count({ where: { organizationId: org.id } });
    const revEx = await revertirLote({ organizationId: org.id, loteId: rEx.loteId, userId: admin.id });
    const rod1Despues = await prisma.part.findUniqueOrThrow({ where: { id: rod1.id } });
    revisar("15. reversión parcial segura: ROD-1 vuelve a cero con una salida; el kardex no se reescribe",
      revEx.estado === "REVERSION_PARCIAL" && rod1Despues.quantityOnHand === 0 &&
      (await prisma.stockMovement.count({ where: { organizationId: org.id } })) === movAntes + 1 &&
      Boolean(await prisma.stockMovement.findFirst({ where: { partId: rod1.id, reference: REFERENCIA_REVERSION, movementType: "OUT" } })) &&
      Boolean(await prisma.stockMovement.findUnique({ where: { id: mov1.id } })), revEx);
    const dEx2 = await diagnosticarReversion(org.id, rEx.loteId);
    revisar("reintentar no vuelve a compensar lo ya compensado", dEx2.aBorrar.length === 0 && dEx2.bloqueados.length === 1, dEx2.aBorrar);
    await rechaza("14. con todo lo que queda ya usado, se bloquea y se dice",
      () => revertirLote({ organizationId: org.id, loteId: rEx.loteId, userId: admin.id }), /ya se usaron/);
    revisar("el lote conserva «reversión parcial» (no se pierde lo que sí se revirtió)",
      (await prisma.importBatch.findUniqueOrThrow({ where: { id: rEx.loteId } })).estado === "REVERSION_PARCIAL");

    // Lecturas: se anulan, no se borran.
    const revLec = await revertirLote({ organizationId: org.id, loteId: rLec.loteId, userId: admin.id });
    const lecturas = await prisma.meterReading.findMany({ where: { meterId: medidor.id } });
    revisar("13. reversión completa de lecturas: quedan anuladas con motivo, el medidor regresa a su valor inicial",
      revLec.estado === "REVERTIDA" && lecturas.length === 2 && lecturas.every((l) => l.estado === "ANULADA" && Boolean(l.correccionMotivo)) &&
      (await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } })).currentValue === 1000, lecturas.map((l) => l.estado));

    // Usuarios: Laura ya entró (usó su liga); Pedro es responsable de un almacén de otro lote.
    await prisma.user.update({ where: { id: laura.id }, data: { lastLoginAt: new Date() } });
    const dUsr = await diagnosticarReversion(org.id, rUsr.loteId);
    revisar("14. usuarios usados no se borran: la que ya entró y el responsable de un almacén",
      dUsr.aBorrar.length === 0 && dUsr.bloqueados.length === 2 &&
      dUsr.bloqueados.some((b) => b.motivos.some((m) => /almacenes a su cargo/.test(m))) &&
      dUsr.bloqueados.some((b) => b.motivos.some((m) => /entró/.test(m))), dUsr.bloqueados.map((b) => b.motivos));
    await rechaza("y revertir se rechaza", () => revertirLote({ organizationId: org.id, loteId: rUsr.loteId, userId: admin.id }), /ya se usaron/);
    revisar("el lote queda como «reversión bloqueada»", (await prisma.importBatch.findUniqueOrThrow({ where: { id: rUsr.loteId } })).estado === "REVERSION_BLOQUEADA");

    // Almacén y medidor: el almacén tiene existencias; el medidor, sin lecturas vigentes, se va.
    const dAlm = await diagnosticarReversion(org.id, rAlm.loteId);
    revisar("un almacén con existencias y movimientos no se borra", dAlm.bloqueados.length === 1 && /existencias|movimientos/.test(dAlm.bloqueados[0].motivos.join()), dAlm.bloqueados);
    const revMed = await revertirLote({ organizationId: org.id, loteId: rMed.loteId, userId: admin.id });
    revisar("un medidor sin lecturas vigentes se revierte completo", revMed.estado === "REVERTIDA" && !(await prisma.meter.findUnique({ where: { id: medidor.id } })));

    // ───────────────────────────────────────────────────────── 11
    console.log("\n11. Una importación de otra empresa");
    await rechaza("diagnosticar un lote ajeno da «no encontrada»", () => diagnosticarReversion(otra.id, rFixture.loteId), /no encontrada/);
    await rechaza("revertirlo, también", () => revertirLote({ organizationId: otra.id, loteId: rFixture.loteId, userId: ajenoCorreo.id }), /no encontrada/);
    revisar("y sus activos siguen ahí", (await prisma.asset.count({ where: { organizationId: org.id, code: { in: ["XL-1", "XL-2"] } } })) === 2);

    // ───────────────────────────────────────────────────────── 19-21, 24
    console.log("\n19-21. Las tres maneras de empezar una empresa");
    const vacia = await nuevaOrg("vacia", { tipoInstalacion: "HOSPITAL" });
    const dVacia = await prisma.user.create({ data: { organizationId: vacia.id, email: `v-${sello}@t.mx`, name: "V", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: vacia.id, userId: dVacia.id, modo: "VACIA" });
    const conteo = async (id: string) => ({
      categorias: await prisma.assetCategory.count({ where: { organizationId: id } }),
      unidades: await prisma.partUnit.count({ where: { organizationId: id } }),
      fallas: await prisma.failureCode.count({ where: { organizationId: id } }),
      sitios: await prisma.site.count({ where: { organizationId: id } }),
      almacenes: await prisma.warehouse.count({ where: { organizationId: id } }),
      activos: await prisma.asset.count({ where: { organizationId: id } }),
      ordenes: await prisma.workOrder.count({ where: { organizationId: id } }),
      movimientos: await prisma.stockMovement.count({ where: { organizationId: id } }),
      usuarios: await prisma.user.count({ where: { organizationId: id } }),
    });
    const cVacia = await conteo(vacia.id);
    const ind = catalogosIndispensables();
    revisar("19. vacía: solo los catálogos técnicos indispensables, nada más",
      cVacia.categorias === 0 && cVacia.unidades === ind.unidades.length && cVacia.fallas === ind.codigosFalla.length &&
      cVacia.sitios === 0 && cVacia.almacenes === 0 && cVacia.activos === 0 && cVacia.usuarios === 1, cVacia);

    const recomendada = await nuevaOrg("rec", { tipoInstalacion: "RESTAURANTE" });
    const dRec = await prisma.user.create({ data: { organizationId: recomendada.id, email: `r-${sello}@t.mx`, name: "R", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: recomendada.id, userId: dRec.id, modo: "RECOMENDADA" });
    const cRec = await conteo(recomendada.id);
    revisar("20. recomendada: catálogos de su giro, primer sitio y almacén; ni activos, ni órdenes, ni movimientos",
      cRec.categorias === catalogosPara("RESTAURANTE").categorias.length && cRec.sitios === 1 && cRec.almacenes === 1 &&
      cRec.activos === 0 && cRec.ordenes === 0 && cRec.movimientos === 0, cRec);
    revisar("el sitio lleva el nombre del giro",
      (await prisma.site.findFirstOrThrow({ where: { organizationId: recomendada.id } })).name === sitioInicialPara("RESTAURANTE"));

    const demo = await nuevaOrg("demo", { tipoInstalacion: "PLANTA", status: "TRIAL" });
    const dDemo = await prisma.user.create({ data: { organizationId: demo.id, email: `d-${sello}@t.mx`, name: "D", role: "OWNER", passwordHash: "x" } });
    await iniciarEmpresa({ organizationId: demo.id, userId: dDemo.id, modo: "DEMO" });
    const cDemo = await conteo(demo.id);
    const activosDemo = await prisma.asset.findMany({ where: { organizationId: demo.id } });
    revisar("21. demo: ejemplos marcados «[DEMO]», registrados como lote DEMO, sin usuarios ni órdenes inventados",
      activosDemo.length === 3 && activosDemo.every((a) => a.name.startsWith(MARCA_DEMO)) && cDemo.usuarios === 1 && cDemo.ordenes === 0 &&
      (await prisma.importBatch.count({ where: { organizationId: demo.id, tipo: "DEMO", estado: "COMPLETADA" } })) === 1, cDemo);

    console.log("\n24. Catálogos por tipo de instalación");
    const tipos = ["PLANTA", "HOSPITAL", "RESTAURANTE", "FLOTILLA", "HOTEL"];
    const cats = tipos.map((t) => catalogosPara(t).categorias.map(([, n]) => n).join("|"));
    revisar("cinco tipos, cinco listas de categorías distintas", new Set(cats).size === tipos.length, cats.map((c) => c.slice(0, 60)));
    revisar("ninguno pasa de diez categorías", tipos.every((t) => catalogosPara(t).categorias.length <= 10));
    revisar("un restaurante no recibe grúas ni acoplamientos",
      !JSON.stringify(catalogosPara("RESTAURANTE")).match(/grúa|acoplamiento/i));
    revisar("los indispensables son los mismos para todos, y sin categorías del giro",
      catalogosIndispensables().categorias.length === 0 && tipos.every((t) => ind.unidades.every(([c]) => catalogosPara(t).unidades.some(([u]) => u === c))));
    revisar("el primer sitio se nombra según el giro", new Set(tipos.map(sitioInicialPara)).size === tipos.length, tipos.map(sitioInicialPara));

    // ───────────────────────────────────────────────────────── 22-23
    console.log("\n22-23. Eliminación controlada de la demostración");
    // Un activo REAL que alguien nombró con «[DEMO]»: nunca se decide por el nombre.
    const engañoso = await prisma.asset.create({
      data: { organizationId: demo.id, siteId: activosDemo[0].siteId, code: "REAL-1", name: `${MARCA_DEMO} equipo real mal nombrado` },
    });
    await prisma.workOrder.create({ data: { organizationId: demo.id, number: "OT-1", title: "Orden real", assetId: activosDemo[1].id } });
    const vista = await vistaPreviaQuitarDemo(demo.id);
    revisar("22. la vista previa trae los conteos: activos, OT, planes, inventario, movimientos, proveedores, usuarios, indicadores",
      vista.conteos.activos === 3 && vista.conteos.ordenes === 1 && vista.conteos.planes === 1 && vista.conteos.refacciones === 2 &&
      vista.conteos.valorInventario > 0 && vista.conteos.movimientos === 2 && vista.conteos.proveedores === 1 && vista.conteos.usuarios === 0 &&
      vista.indicadores.length > 0, vista.conteos);
    revisar("el activo real con «[DEMO]» en el nombre no está en la lista", !vista.aBorrar.some((r) => r.id === engañoso.id) && !vista.bloqueados.some((r) => r.id === engañoso.id));
    await rechaza("sin confirmación explícita no se elimina nada",
      () => quitarDemo({ organizationId: demo.id, userId: dDemo.id, confirmado: false }), /Confirme/);
    revisar("y todo sigue ahí", (await prisma.asset.count({ where: { organizationId: demo.id } })) === 4);
    const quitado = await quitarDemo({ organizationId: demo.id, userId: dDemo.id, confirmado: true });
    revisar("23. el equipo demo con una orden real se queda y se informa",
      quitado.bloqueados.some((b) => b.id === activosDemo[1].id && b.motivos.some((m) => /órdenes/.test(m))) &&
      Boolean(await prisma.asset.findUnique({ where: { id: activosDemo[1].id } })), quitado.bloqueados.map((b) => b.nombre));
    revisar("lo demás de la demo se fue; el activo real, no",
      !(await prisma.asset.findUnique({ where: { id: activosDemo[0].id } })) && Boolean(await prisma.asset.findUnique({ where: { id: engañoso.id } })));
    revisar("la cuenta sigue en prueba: quitar la demo no toca el estado comercial",
      (await prisma.organization.findUniqueOrThrow({ where: { id: demo.id } })).status === "TRIAL");

    // ───────────────────────────────────────────────────────── 25-26 y cobertura
    console.log("\n25-26. Estado operativo aparte del comercial, y cobertura preventiva");
    const activa = await nuevaOrg("activa", { tipoInstalacion: "EDIFICIO", status: "ACTIVE" });
    const jefa = await prisma.user.create({ data: { organizationId: activa.id, email: `j-${sello}@t.mx`, name: "Jefa", role: "OWNER", passwordHash: "x" } });
    const m0 = await puestaEnMarcha(activa.id);
    revisar("25. comercialmente activa y operativamente en configuración, con sus bloqueos",
      activa.status === "ACTIVE" && m0.estadoOperativo === "CONFIGURACION" && m0.impideOperar.length > 0, m0.impideOperar);
    await rechaza("con bloqueos no se puede declarar", () => comenzarAOperar({ organizationId: activa.id, userId: jefa.id }), /Todavía no se puede/);

    await iniciarEmpresa({ organizationId: activa.id, userId: jefa.id, modo: "RECOMENDADA" });
    const s = await prisma.site.findFirstOrThrow({ where: { organizationId: activa.id } });
    const piso = await prisma.location.create({ data: { organizationId: activa.id, siteId: s.id, code: "PB", name: "Planta baja" } });
    // Sin tarifa: advertencia, no bloqueo.
    await prisma.user.create({ data: { organizationId: activa.id, email: `t-${sello}@t.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: "x" } });
    const eq = async (code: string) => prisma.asset.create({ data: { organizationId: activa.id, siteId: s.id, locationId: piso.id, code, name: `Equipo ${code}`, criticality: "A" } });
    const [a1, a2] = [await eq("ACT-001"), await eq("ACT-017")];
    const plan = await prisma.maintenancePlan.create({
      data: { organizationId: activa.id, name: "Revisión", intervalDays: 30, assetId: a1.id, tasks: { create: [{ position: 0, title: "Revisar" }] } },
    });
    await asignarPlan({ organizationId: activa.id, planId: plan.id, equipos: [{ assetId: a1.id, desde: new Date(Date.now() + 86_400_000), desdeEsUltima: false }] });
    const m1 = await puestaEnMarcha(activa.id);
    const pasoPlanes = m1.pasos.find((p) => p.clave === "planes")!;
    revisar("12. planes correctos y cobertura incompleta son dos datos: «1 de 1 correctos» y «cobertura 1 de 2»",
      pasoPlanes.progreso?.hecho === 1 && pasoPlanes.progreso.meta === 1 && pasoPlanes.cobertura?.hecho === 1 && pasoPlanes.cobertura.meta === 2, { progreso: pasoPlanes.progreso, cobertura: pasoPlanes.cobertura });
    revisar("sin contradicción: no dice «requiere corrección» cuando todos los planes están bien", pasoPlanes.estado === "EN_PROCESO", pasoPlanes.estado);
    revisar("y nombra el equipo que falta", /ACT-017/.test(pasoPlanes.falta) && /ACT-017/.test(pasoPlanes.cobertura?.texto ?? ""), pasoPlanes.falta);
    revisar("el equipo crítico sin plan bloquea el arranque", m1.estadoOperativo === "CONFIGURACION" && m1.impideOperar.some((b) => /ACT-017/.test(b)), m1.impideOperar);

    await asignarPlan({ organizationId: activa.id, planId: plan.id, equipos: [{ assetId: a2.id, desde: new Date(Date.now() + 86_400_000), desdeEsUltima: false }] });
    const m2 = await puestaEnMarcha(activa.id);
    revisar("resuelto lo crítico: «lista para operar», aunque queden advertencias (tarifa, almacén vacío)",
      m2.estadoOperativo === "LISTA" && m2.impideOperar.length === 0 && m2.advertenciasOperar.some((a) => /tarifa/.test(a)), { impide: m2.impideOperar, avisos: m2.advertenciasOperar });
    revisar("el porcentaje y la lista de calidad siguen disponibles", typeof m2.porcentaje === "number" && Array.isArray(m2.pendientes) && m2.pendientes.length > 0);
    await comenzarAOperar({ organizationId: activa.id, userId: jefa.id });
    const declarada = await prisma.organization.findUniqueOrThrow({ where: { id: activa.id } });
    const m3 = await puestaEnMarcha(activa.id);
    revisar("26. declarada: queda quién y cuándo, y el estado dice «operando»",
      Boolean(declarada.operandoDesde) && declarada.operandoPorId === jefa.id && m3.estadoOperativo === "OPERANDO" && m3.operandoPor === "Jefa");
    revisar("el estado comercial no cambió", declarada.status === "ACTIVE");
    const evento = await prisma.auditLog.findFirst({ where: { organizationId: activa.id, action: "OPERATION_STARTED" } });
    revisar("queda en la bitácora con el estado anterior y las advertencias",
      Boolean(evento) && JSON.parse(evento!.changes ?? "{}").estadoAnterior === "LISTA" && JSON.parse(evento!.changes ?? "{}").advertencias.length > 0, evento?.changes);

    // ───────────────────────────────────────────────────────── 12 por HTTP
    console.log("\n11-12. Por HTTP: permisos, otra empresa, Excel y el alta del operador");
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(llaveDeSesion());
    const firmar = async (u: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      `mt_session=${await new SignJWT({ userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    const pedir = async (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown>, tipo: r.headers.get("content-type") };
    };
    const supervisor = await prisma.user.create({ data: { organizationId: org.id, email: `sup-${sello}@t.mx`, name: "Sup", role: "SUPERVISOR", passwordHash: "x" } });
    const cSup = await firmar(supervisor);
    const cAdmin = await firmar(admin);
    const cAjeno = await firmar(ajenoCorreo);
    const cuerpoXlsx = { contenido: xlsx([["codigo", "nombre", "sitio"], ["H-1", "Por HTTP", "P01"]]).contenido, formato: "xlsx", archivoNombre: "h.xlsx" };
    revisar("un supervisor no puede validar (403)", (await pedir("POST", "/api/import/activos", cSup, cuerpoXlsx)).status === 403);
    revisar("ni confirmar (403)", (await pedir("PUT", "/api/import/activos", cSup, cuerpoXlsx)).status === 403);
    revisar("ni revertir (403)", (await pedir("POST", `/api/import/lotes/${rFixture.loteId}/revertir`, cSup)).status === 403);
    revisar("otra empresa no revierte un lote ajeno cambiando el id (404)", (await pedir("POST", `/api/import/lotes/${rFixture.loteId}/revertir`, cAjeno)).status === 404);
    const vHttp = await pedir("POST", "/api/import/activos", cAdmin, cuerpoXlsx);
    const pHttp = await pedir("PUT", "/api/import/activos", cAdmin, cuerpoXlsx);
    revisar("el administrador valida y confirma un Excel por HTTP", vHttp.status === 200 && pHttp.status === 200 && pHttp.json.creados === 1, [vHttp.status, pHttp.status, pHttp.json]);
    const plantilla = await fetch(`${base}/api/import/usuarios/template?formato=xlsx`, { headers: { Cookie: cAdmin } });
    const bytes = Buffer.from(await plantilla.arrayBuffer());
    revisar("la plantilla de Excel se descarga como .xlsx", plantilla.ok && /spreadsheetml/.test(plantilla.headers.get("content-type") ?? "") && bytes.subarray(0, 2).toString() === "PK");

    const operador = await prisma.user.create({
      data: { organizationId: org.id, email: `op-${sello}@t.mx`, name: "Operador", role: "OWNER", isSuperAdmin: true, passwordHash: "x" },
    });
    const cOp = await firmar(operador);
    const sinModo = await pedir("POST", "/api/admin/organizations", cOp, {
      name: `${sello}-alta0`, tipoInstalacion: "HOTEL", ownerName: "Resp", ownerEmail: `alta0-${sello}@t.mx`, ownerPassword: "ClaveInicial1",
    });
    revisar("el alta sin elegir cómo empieza se rechaza", sinModo.status === 422, sinModo.json.error);
    const alta = await pedir("POST", "/api/admin/organizations", cOp, {
      name: `${sello}-alta`, tipoInstalacion: "HOTEL", ownerName: "Resp", ownerEmail: `alta-${sello}@t.mx`, ownerPassword: "ClaveInicial1", modo: "RECOMENDADA",
    });
    const altaId = (alta.json.organization as { id: string } | undefined)?.id;
    if (altaId) creadas.push(altaId);
    const cAlta = altaId ? await conteo(altaId) : null;
    revisar("el alta del operador con «recomendada» crea empresa, responsable, catálogos del giro, sitio y almacén",
      alta.status === 201 && cAlta?.usuarios === 1 && cAlta.categorias === catalogosPara("HOTEL").categorias.length && cAlta.sitios === 1 && cAlta.activos === 0, cAlta);

    // ───────────────────────────────────────────────────────── 27
    console.log("\n27. Auditoría de todo lo anterior");
    const acciones = async (id: string) => new Set((await prisma.auditLog.findMany({ where: { organizationId: id }, select: { action: true } })).map((a) => a.action));
    const aImp = await acciones(org.id);
    for (const a of ["IMPORT_VALIDATED", "IMPORT_CONFIRMED", "IMPORT_COMPLETED", "IMPORT_FAILED", "IMPORT_REVERT_REQUESTED", "IMPORT_REVERTED", "IMPORT_REVERT_PARTIAL", "IMPORT_REVERT_BLOCKED"]) {
      revisar(`importación: ${a}`, aImp.has(a));
    }
    const completado = await prisma.auditLog.findFirst({ where: { organizationId: org.id, action: "IMPORT_COMPLETED", entityId: rAct.loteId } });
    revisar("la completada dice creados, actualizados y duplicados omitidos",
      /creados.*actualizados.*omitidos/.test(completado?.summary ?? ""), completado?.summary);
    revisar("empresa vacía: SETUP_STARTED con su modo", (await prisma.auditLog.count({ where: { organizationId: vacia.id, action: "SETUP_STARTED", changes: { contains: "\"modo\":\"VACIA\"" } } })) === 1);
    revisar("empresa recomendada: SETUP_STARTED con su modo", (await prisma.auditLog.count({ where: { organizationId: recomendada.id, action: "SETUP_STARTED", changes: { contains: "RECOMENDADA" } } })) === 1);
    revisar("empresa demo: DEMO_CREATED y DEMO_REMOVED con los conteos", (await acciones(demo.id)).has("DEMO_CREATED") &&
      (await prisma.auditLog.count({ where: { organizationId: demo.id, action: "DEMO_REMOVED", changes: { contains: "\"activos\":3" } } })) === 1);
    revisar("alta del operador: ORG_CREATED en la empresa nueva", Boolean(altaId) && (await acciones(altaId!)).has("ORG_CREATED"));
    revisar("declaración de operación: OPERATION_STARTED", (await acciones(activa.id)).has("OPERATION_STARTED"));
    const todo = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: { in: creadas } } }));
    revisar("la bitácora no guarda contenidos de archivo, contraseñas ni ligas",
      !todo.includes("Secreta123") && !todo.includes("ClaveInicial1") && !todo.includes("NuevaClaveSegura1") && !todo.includes(liga.token) && !todo.includes("Tres bis"));
  } finally {
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    if (servidor?.pid) {
      try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya termino */ }
    }
  }

  console.log("\nAislamiento de la prueba");
  revisar("las demás empresas quedaron exactamente como estaban", antes === await fotoAjena(() => creadas));

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e instanceof ErrorDeImportacion || e instanceof ErrorDeLote ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
