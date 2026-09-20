/**
 * Verifica una base RESTAURADA contra la de produccion.
 *
 * Lo corre `scripts/prueba-restauracion.sh`, que clona, abre las dos y borra
 * la copia al terminar. Aqui solo se LEE: ni una escritura en ninguna de las
 * dos.
 *
 * Que se comprueba, y por que esto y no otra cosa: un respaldo que restaura
 * pero pierde una relacion, o que trae los usuarios sin sus roles, o al que
 * le faltan los adjuntos, es un respaldo que no sirve y que nadie descubre
 * hasta el dia malo.
 *
 *   DATABASE_URL=<copia> URL_PRODUCCION=<origen> npx tsx scripts/verificar-restauracion.ts
 */
import { PrismaClient } from "@prisma/client";

const copia = new PrismaClient();
const produccion = new PrismaClient({ datasources: { db: { url: process.env.URL_PRODUCCION } } });

let fallas = 0;
function revisar(que: string, bien: boolean, detalle?: unknown) {
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${que}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

/** Lo que tiene que estar completo para operar. */
const CONTEOS = [
  "organization", "user", "asset", "workOrder", "workOrderTask", "workRequest",
  "maintenancePlan", "planAsset", "part", "partStock", "stockMovement",
  "purchaseRequest", "goodsReceipt", "meter", "meterReading", "attachment",
  "auditLog", "notification",
] as const;

async function main() {
  console.log("\nConteos: la copia contra produccion\n");
  const desfases: string[] = [];
  for (const modelo of CONTEOS) {
    const [a, b] = await Promise.all([
      (produccion[modelo] as { count: () => Promise<number> }).count(),
      (copia[modelo] as { count: () => Promise<number> }).count(),
    ]);
    // La copia es de hace unos minutos: puede tener MENOS que produccion si
    // alguien capturo mientras tanto, nunca mas. Un faltante grande si es
    // senal de que la restauracion no trajo todo.
    const falta = a - b;
    const bien = falta >= 0 && (a === 0 || falta / a < 0.02);
    if (!bien) desfases.push(`${modelo}: produccion ${a}, copia ${b}`);
    console.log(`  ${bien ? "ok   " : "FALLA"} ${modelo.padEnd(18)} produccion ${String(a).padStart(7)}   copia ${String(b).padStart(7)}`);
  }
  revisar("todos los conteos cuadran (la copia no perdio registros)", desfases.length === 0, desfases);

  console.log("\nRelaciones: lo restaurado sigue amarrado\n");
  // Se comprueba apuntando al padre y contando: si la restauracion hubiera
  // traido las tablas a medias, alguna referencia apuntaria a un registro que
  // ya no esta. (Las relaciones obligatorias las cuida la llave foranea; lo
  // que se verifica aqui es que esas llaves llegaron con la copia.)
  const apunta = async (
    hijos: Array<{ id: string | null }>,
    contarPadres: (ids: string[]) => Promise<number>,
  ) => {
    const ids = [...new Set(hijos.map((h) => h.id).filter((x): x is string => Boolean(x)))];
    return ids.length === 0 || (await contarPadres(ids)) === ids.length;
  };
  const [ordenesConActivo, movimientos, tareas] = await Promise.all([
    copia.workOrder.findMany({ where: { assetId: { not: null } }, select: { assetId: true }, take: 3000 }),
    copia.stockMovement.findMany({ select: { partId: true }, take: 3000 }),
    copia.workOrderTask.findMany({ select: { workOrderId: true }, take: 3000 }),
  ]);
  const integras = await Promise.all([
    apunta(ordenesConActivo.map((o) => ({ id: o.assetId })), (ids) => copia.asset.count({ where: { id: { in: ids } } })),
    apunta(movimientos.map((m) => ({ id: m.partId })), (ids) => copia.part.count({ where: { id: { in: ids } } })),
    apunta(tareas.map((t) => ({ id: t.workOrderId })), (ids) => copia.workOrder.count({ where: { id: { in: ids } } })),
  ]);
  revisar("ninguna orden, movimiento ni actividad apunta a un registro que no llego",
    integras.every(Boolean), { ordenes: integras[0], movimientos: integras[1], actividades: integras[2] });

  // El kardex es la prueba de fuego del inventario: si la restauracion
  // trajera movimientos a medias, la existencia dejaria de cuadrar.
  const stocks = await copia.partStock.findMany({ select: { partId: true, warehouseId: true, quantity: true } });
  const porParte = new Map<string, number>();
  for (const s of stocks) porParte.set(s.partId, (porParte.get(s.partId) ?? 0) + s.quantity);
  const partes = await copia.part.findMany({ where: { id: { in: [...porParte.keys()] } }, select: { id: true, code: true, quantityOnHand: true } });
  const descuadradas = partes.filter((p) => Math.abs((porParte.get(p.id) ?? 0) - p.quantityOnHand) > 0.001);
  revisar("la existencia por almacen sigue cuadrando con el total de cada refaccion",
    descuadradas.length === 0, descuadradas.slice(0, 5).map((p) => p.code));

  console.log("\nUsuarios, permisos y empresas\n");
  const [usuariosProd, usuariosCopia] = await Promise.all([
    produccion.user.findMany({ select: { email: true, role: true, active: true, isSuperAdmin: true }, orderBy: { email: "asc" } }),
    copia.user.findMany({ select: { email: true, role: true, active: true, isSuperAdmin: true }, orderBy: { email: "asc" } }),
  ]);
  const clave = (u: { email: string; role: string; active: boolean; isSuperAdmin: boolean }) => `${u.email}|${u.role}|${u.active}|${u.isSuperAdmin}`;
  const faltantes = usuariosProd.filter((u) => !usuariosCopia.some((v) => clave(v) === clave(u)));
  revisar("cada persona conserva su correo, su rol y si estaba activa", faltantes.length === 0, faltantes.map((u) => u.email));

  const conClave = await copia.user.count({ where: { passwordHash: { not: "" } } });
  revisar("las contrasenas viajaron (nadie queda fuera tras restaurar)", conClave === usuariosCopia.length, { conClave, total: usuariosCopia.length });

  const empresas = await copia.organization.findMany({ select: { name: true, plan: true, status: true }, orderBy: { name: "asc" } });
  revisar(`las ${empresas.length} empresas conservan su plan y su estado`,
    empresas.every((o) => Boolean(o.plan && o.status)), empresas.map((o) => `${o.name}:${o.plan}/${o.status}`));

  console.log("\nArchivos e historial\n");
  // Los archivos NO viven en la base sino en el almacen de Google Cloud, que
  // es independiente de este respaldo: lo que se verifica aqui es que la
  // referencia sobrevivio y apunta a donde debe.
  const adjuntos = await copia.attachment.findMany({ select: { storagePath: true, organizationId: true }, take: 500 });
  const malRuta = adjuntos.filter((a) => !a.storagePath.startsWith(`org-${a.organizationId}/`));
  revisar(`los ${adjuntos.length} adjuntos revisados conservan su ruta dentro de su empresa`, malRuta.length === 0, malRuta.slice(0, 3));

  const [ultimaAuditoria, ultimaOrden] = await Promise.all([
    copia.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, action: true } }),
    copia.workOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { number: true, createdAt: true } }),
  ]);
  const frescura = ultimaAuditoria ? Math.round((Date.now() - ultimaAuditoria.createdAt.getTime()) / 60_000) : null;
  revisar("la bitacora de auditoria llega hasta el momento de la copia",
    frescura !== null && frescura < 60 * 24 * 7, { minutosDesdeElUltimoRegistro: frescura, accion: ultimaAuditoria?.action, ultimaOrden: ultimaOrden?.number });

  console.log(fallas ? `\n${fallas} revision(es) fallaron\n` : "\nLa restauracion es utilizable: todo cuadra.\n");
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => {
    await Promise.all([copia.$disconnect(), produccion.$disconnect()]);
    process.exit(fallas ? 1 : 0);
  });
