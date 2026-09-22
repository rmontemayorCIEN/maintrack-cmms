/**
 * Bloque 3 — La matriz de roles, aplicada por el SERVIDOR.
 *
 * Esconder un boton no es un permiso. Esta prueba entra por la puerta de atras:
 * firma una sesion de cada rol y llama a las rutas directamente, como lo haria
 * cualquiera con la consola del navegador abierta.
 *
 * Lo que se espera de cada rol esta escrito ABAJO, a mano. No se deriva de
 * `lib/rbac.ts` a proposito: si se derivara, la prueba solo confirmaria que el
 * codigo hace lo que el codigo dice, y un cambio de matriz pasaria inadvertido.
 *
 *   npx tsx scripts/prueba-permisos.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { apagarServidor } from "./apagar-servidor";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

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

const ROLES = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER"] as const;
type Rol = (typeof ROLES)[number];

/**
 * Quien puede hacer cada cosa, en lenguaje de negocio.
 *
 * Es la fuente de la verdad para la prueba y para el documento del bloque.
 * VIEWER no aparece en ninguna: es de solo lectura por construccion.
 */
const PERMITIDO: Record<string, Rol[]> = {
  "crear una orden de trabajo": ["OWNER", "ADMIN", "SUPERVISOR"],
  "registrar horas en una orden": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  "cargar una refacción a una orden": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  "cerrar una orden": ["OWNER", "ADMIN", "SUPERVISOR"],
  "dar de alta un activo": ["OWNER", "ADMIN", "SUPERVISOR"],
  "crear un plan de mantenimiento": ["OWNER", "ADMIN", "SUPERVISOR"],
  "levantar una solicitud": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER"],
  "revisar una solicitud": ["OWNER", "ADMIN", "SUPERVISOR"],
  "mover existencia en el almacén": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  "pedir material con un vale": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER"],
  "surtir un vale": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  "solicitar una compra": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS"],
  "autorizar una compra": ["OWNER", "ADMIN"],
  // El catalogo de proveedores es administracion: mismo permiso que la
  // configuracion de la empresa.
  "dar de alta un proveedor": ["OWNER", "ADMIN"],
  "dar de alta un usuario": ["OWNER", "ADMIN"],
  "cambiar la configuración de la empresa": ["OWNER", "ADMIN"],
  "exportar información": ["OWNER", "ADMIN", "SUPERVISOR"],
};

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3199";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3199", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `perm-${Date.now()}`;
  const secreto = new TextEncoder().encode(llaveDeSesion());
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });

  try {
    await esperarServidor(base, 240_000);

    const cookies: Record<Rol, string> = {} as Record<Rol, string>;
    for (const rol of ROLES) {
      const u = await prisma.user.create({
        data: { organizationId: org.id, email: `${rol}-${sello}@t.mx`, name: `Persona ${rol}`, role: rol, passwordHash: "x" },
      });
      cookies[rol] = `mt_session=${await new SignJWT({ userId: u.id, organizationId: org.id, email: u.email, name: u.name, role: rol })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    }

    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "SIT", name: "Planta" } });
    const activo = await prisma.asset.create({ data: { organizationId: org.id, code: "ACT-1", name: "Bomba", siteId: sitio.id } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: org.id, name: "Almacen", code: "ALM" } });
    const refaccion = await prisma.part.create({
      data: { organizationId: org.id, code: "REF-1", name: "Rodamiento", unit: "pza", unitCost: 50, quantityOnHand: 20 },
    });
    await prisma.partStock.create({ data: { organizationId: org.id, partId: refaccion.id, warehouseId: almacen.id, quantity: 20 } });

    const pedir = async (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, texto: (await r.text()).slice(0, 160) };
    };

    /**
     * Cada accion se ejecuta de verdad. Por eso cada una se arma con sus
     * propios datos: si la primera la hace el propietario, la siguiente no
     * puede fallar por un folio repetido y parecer un permiso denegado.
     */
    let n = 0;
    const acciones: Record<string, (cookie: string) => Promise<{ status: number; texto: string }>> = {
      "crear una orden de trabajo": (c) => pedir("POST", "/api/work-orders", c, { title: `Orden ${++n}`, assetId: activo.id, maintenanceType: "CORRECTIVE", priority: "MEDIUM" }),
      "dar de alta un activo": (c) => pedir("POST", "/api/assets", c, { code: `A-${++n}`, name: `Equipo ${n}`, siteId: sitio.id }),
      "crear un plan de mantenimiento": (c) => pedir("POST", "/api/plans", c, { name: `Plan ${++n}`, assetId: activo.id, intervalDays: 30, maintenanceType: "PREVENTIVE" }),
      "levantar una solicitud": (c) => pedir("POST", "/api/requests", c, { title: `Reporte ${++n} de prueba`, assetId: activo.id, priority: "MEDIUM" }),
      "mover existencia en el almacén": (c) => pedir("POST", "/api/parts/movements", c, { partId: refaccion.id, warehouseId: almacen.id, movementType: "IN", quantity: 1, unitCost: 50, reference: "Sobrante de obra" }),
      "dar de alta un proveedor": (c) => pedir("POST", "/api/suppliers", c, { name: `Proveedor ${++n}` }),
      "dar de alta un usuario": (c) => pedir("POST", "/api/users", c, { name: `Persona ${++n}`, email: `nueva${n}-${sello}@t.mx`, password: "clavelarga123", role: "TECHNICIAN" }),
      "cambiar la configuración de la empresa": (c) => pedir("PATCH", "/api/work-orders/config", c, { agruparPorEquipo: true }),
      "exportar información": (c) => pedir("GET", "/api/export/work-orders", c),
      "solicitar una compra": (c) => pedir("POST", "/api/compras", c, {
        warehouseId: almacen.id, urgencia: "NORMAL",
        renglones: [{ partId: refaccion.id, descripcion: "REF-1", cantidadSolicitada: 1, costoEstimado: 10 }],
      }),
      "pedir material con un vale": (c) => pedir("POST", "/api/requisiciones", c, {
        warehouseId: almacen.id, motivo: "CORRECTIVO", assetId: activo.id,
        renglones: [{ partId: refaccion.id, descripcion: "REF-1 rodamiento", cantidadSolicitada: 1 }],
      }),
    };

    console.log("\n1. Cada rol contra cada acción, llamando a la API directo");
    for (const [accion, ejecutar] of Object.entries(acciones)) {
      const esperado = PERMITIDO[accion];
      const malos: string[] = [];
      for (const rol of ROLES) {
        const r = await ejecutar(cookies[rol]);
        // Lo que mide el permiso es el 403. Un 422 es una regla de negocio
        // —falta un dato, el documento no esta en ese estado— y significa que
        // la puerta SI se abrio.
        const permitido = r.status !== 403;
        const deberia = esperado.includes(rol);
        if (permitido !== deberia) malos.push(`${rol}=${r.status}${deberia ? " (debía poder)" : " (NO debía)"}`);
      }
      revisar(`${accion}: ${esperado.join(", ")}`, malos.length === 0, malos.length ? malos : undefined);
    }

    // Las acciones sobre un documento existente van aparte: necesitan que el
    // documento exista y en el estado correcto.
    console.log("\n2. Acciones sobre documentos ya creados");
    for (const rol of ROLES) {
      const ot = await prisma.workOrder.create({
        data: { organizationId: org.id, number: `OT-P${++n}`, title: "Para cerrar", assetId: activo.id, status: "COMPLETED", completedAt: new Date(), resolution: "Listo", assignedToId: null },
      });
      const r = await pedir("POST", `/api/work-orders/${ot.id}/status`, cookies[rol], { status: "CLOSED" });
      const deberia = PERMITIDO["cerrar una orden"].includes(rol);
      revisar(`cerrar una orden · ${rol}`, (r.status !== 403) === deberia, { status: r.status, deberia });
    }
    for (const rol of ROLES) {
      const ot = await prisma.workOrder.create({
        data: { organizationId: org.id, number: `OT-H${++n}`, title: "Para horas", assetId: activo.id, status: "IN_PROGRESS", startedAt: new Date() },
      });
      const persona = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id, role: "TECHNICIAN" } });
      const r = await pedir("POST", `/api/work-orders/${ot.id}/labor`, cookies[rol], { userId: persona.id, hours: 1 });
      const deberia = PERMITIDO["registrar horas en una orden"].includes(rol);
      revisar(`registrar horas · ${rol}`, (r.status !== 403) === deberia, { status: r.status, deberia });

      const r2 = await pedir("POST", `/api/work-orders/${ot.id}/parts`, cookies[rol], { partId: refaccion.id, quantity: 1, warehouseId: almacen.id });
      const deberia2 = PERMITIDO["cargar una refacción a una orden"].includes(rol);
      revisar(`cargar refacción · ${rol}`, (r2.status !== 403) === deberia2, { status: r2.status, deberia: deberia2 });
    }
    for (const rol of ROLES) {
      const sol = await prisma.workRequest.create({
        data: { organizationId: org.id, number: `SOL-P${++n}`, title: "Para revisar", status: "PENDING", assetId: activo.id },
      });
      const r = await pedir("POST", `/api/requests/${sol.id}`, cookies[rol], { action: "REJECT", reviewNotes: "no procede por ahora" });
      const deberia = PERMITIDO["revisar una solicitud"].includes(rol);
      revisar(`revisar una solicitud · ${rol}`, (r.status !== 403) === deberia, { status: r.status, deberia });
    }
    for (const rol of ROLES) {
      const compra = await prisma.purchaseRequest.create({
        data: { organizationId: org.id, folio: `RC-P${++n}`, warehouseId: almacen.id, urgencia: "NORMAL", montoEstimado: 100, estado: "SOLICITADA" },
      });
      const r = await pedir("POST", `/api/compras/${compra.id}`, cookies[rol], { accion: "AUTORIZAR" });
      const deberia = PERMITIDO["autorizar una compra"].includes(rol);
      revisar(`autorizar una compra · ${rol}`, (r.status !== 403) === deberia, { status: r.status, deberia });
    }
    for (const rol of ROLES) {
      const vale = await prisma.materialRequest.create({
        data: {
          organizationId: org.id, folio: `RM-P${++n}`, warehouseId: almacen.id, motivo: "CORRECTIVO",
          renglones: { create: [{ partId: refaccion.id, descripcion: "REF-1", cantidadSolicitada: 1 }] },
        },
        include: { renglones: true },
      });
      const r = await pedir("POST", `/api/requisiciones/${vale.id}`, cookies[rol], {
        accion: "SURTIR", entregadoA: "Quien recoge", renglones: [{ lineId: vale.renglones[0].id, cantidad: 1 }],
      });
      const deberia = PERMITIDO["surtir un vale"].includes(rol);
      revisar(`surtir un vale · ${rol}`, (r.status !== 403) === deberia, { status: r.status, deberia });
    }
    console.log("\n3. La interfaz ofrece lo mismo que el servidor permite");
    const pantalla = async (ruta: string, rol: Rol) => {
      const r = await fetch(`${base}${ruta}`, {
        headers: { Cookie: cookies[rol] }, signal: AbortSignal.timeout(120_000),
      });
      return r.text();
    };
    // Exportar: quien no puede, no ve el boton. Es la contraparte de que el
    // servidor conteste 403; ofrecerlo y luego negarlo es peor que no ofrecerlo.
    for (const rol of ["OWNER", "SUPERVISOR"] as Rol[]) {
      revisar(`${rol} ve «Exportar CSV» en inventario`, (await pantalla("/inventory", rol)).includes("Exportar CSV"));
    }
    for (const rol of ["TECHNICIAN", "REQUESTER", "VIEWER"] as Rol[]) {
      revisar(`${rol} NO ve «Exportar CSV» en inventario`, !(await pantalla("/inventory", rol)).includes("Exportar CSV"));
    }
    for (const rol of ["TECHNICIAN", "VIEWER"] as Rol[]) {
      revisar(`${rol} NO ve «Exportar CSV» en activos`, !(await pantalla("/assets", rol)).includes("Exportar CSV"));
    }
    // Consulta es de solo lectura por construccion: ninguna pantalla le ofrece
    // dar de alta nada.
    const htmlViewer = await pantalla("/assets", "VIEWER");
    revisar("consulta no ve el botón de alta de activos", !/Nuevo activo|Agregar activo/i.test(htmlViewer));

  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    if (servidor?.pid) {
      await apagarServidor(servidor, 3199);
    }
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
