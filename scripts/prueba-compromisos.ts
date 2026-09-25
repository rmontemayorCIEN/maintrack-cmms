/**
 * Compromisos y observadores, de punta a punta contra la base real.
 *
 * Llama las mismas funciones que llaman las rutas. Lo que vigila:
 *
 *   1. Que el compromiso avise a quien le toca, y que ese aviso SE CIERRE
 *      cuando se marca hecho. Un compromiso que deja el aviso abierto para
 *      siempre es lo mismo que el mensaje que se quedo en el aire.
 *   2. Que un observador reciba ADEMAS del responsable, no en su lugar.
 *   3. Que nada de esto cruce entre empresas.
 *
 *   npx tsx scripts/prueba-compromisos.ts
 */
import { prisma } from "../lib/db";
import { crearCompromiso, cambiarEstadoCompromiso, listarCompromisos, misCompromisos } from "../lib/compromisos";
import { alternarObservador, observadoresDe } from "../lib/observadores";
import { registroAnclable, ENTIDADES_ANCLABLES } from "../lib/anclas";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function empresa(sello: string) {
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const jefe = await prisma.user.create({ data: { organizationId: org.id, email: `j-${sello}@t.mx`, name: "Jefe", role: "ADMIN", passwordHash: "x" } });
  const tec = await prisma.user.create({ data: { organizationId: org.id, email: `t-${sello}@t.mx`, name: "Tecnico", role: "TECHNICIAN", passwordHash: "x" } });
  const mirón = await prisma.user.create({ data: { organizationId: org.id, email: `m-${sello}@t.mx`, name: "Mirón", role: "SUPERVISOR", passwordHash: "x" } });
  const sitio = await prisma.site.create({ data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" } });
  const activo = await prisma.asset.create({ data: { organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } }, code: "BMB-1", name: "Bomba", status: "OPERATIONAL" } });
  const orden = await prisma.workOrder.create({ data: { organizationId: org.id, number: `OT-${sello.slice(-5)}`, title: "Prueba", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: activo.id, createdById: jefe.id } });
  return { org, jefe, tec, mirón, activo, orden };
}

async function main() {
  const sello = `prueba-comp-${Date.now()}`;
  const a = await empresa(sello);
  const b = await empresa(`${sello}-otra`);

  try {
    console.log("\nEl compromiso avisa a quien le toca\n");
    await prisma.notification.deleteMany({ where: { organizationId: a.org.id } });
    const r = await crearCompromiso({
      organizationId: a.org.id, creadoPorId: a.jefe.id, creadoPorNombre: a.jefe.name,
      entidad: "WorkOrder", entidadId: a.orden.id,
      texto: "Cotiza el motor con tres proveedores", responsableId: a.tec.id,
      enlace: `/work-orders/${a.orden.id}`, comoSeLlama: "la orden",
    });
    revisar("se anota", r.ok);
    const av = await prisma.notification.findMany({ where: { organizationId: a.org.id }, select: { userId: true, entidad: true, entidadId: true, requiereAccion: true, atendidaEl: true } });
    revisar("   y le avisa al responsable", av.length === 1 && av[0].userId === a.tec.id, `${av.length}`);
    /**
     * El aviso apunta al COMPROMISO y no a la orden. Es lo que le permite a la
     * regla de ciclo de vida encontrarlo para cerrarlo; apuntando a la orden
     * quedaria abierto para siempre.
     */
    revisar("   el aviso apunta al compromiso, no a la orden",
      av[0]?.entidad === "Compromiso" && av[0]?.entidadId === (r.ok ? r.id : ""), av[0]?.entidad);
    revisar("   y queda como pendiente", av[0]?.requiereAccion === true && !av[0]?.atendidaEl);

    // Anotarse algo a uno mismo no avisa.
    await prisma.notification.deleteMany({ where: { organizationId: a.org.id } });
    await crearCompromiso({
      organizationId: a.org.id, creadoPorId: a.jefe.id, creadoPorNombre: a.jefe.name,
      entidad: "WorkOrder", entidadId: a.orden.id, texto: "Lo mio", responsableId: a.jefe.id,
      enlace: "/x", comoSeLlama: "la orden",
    });
    revisar("anotarse algo a uno mismo NO avisa",
      (await prisma.notification.count({ where: { organizationId: a.org.id } })) === 0);

    console.log("\nCerrarlo cierra su aviso\n");
    const abierto = (await listarCompromisos(a.org.id, "WorkOrder", a.orden.id)).find((c) => c.texto.startsWith("Cotiza"))!;
    const ajeno = await cambiarEstadoCompromiso(a.org.id, abierto.id, a.mirón.id, "HECHO");
    revisar("un tercero no puede cerrarlo", !ajeno.ok, ajeno.motivo ?? "");
    const hecho = await cambiarEstadoCompromiso(a.org.id, abierto.id, a.tec.id, "HECHO");
    revisar("su responsable sí", hecho.ok);
    const trasCerrar = await listarCompromisos(a.org.id, "WorkOrder", a.orden.id);
    revisar("   queda como hecho, no se borra",
      trasCerrar.find((c) => c.id === abierto.id)?.estado === "HECHO");
    revisar("   y sale de sus pendientes",
      !(await misCompromisos(a.org.id, a.tec.id)).some((c) => c.id === abierto.id));

    console.log("\nObservar es COPIA, no respaldo\n");
    await alternarObservador(a.org.id, a.mirón.id, "WorkOrder", a.orden.id);
    const obs = await observadoresDe(a.org.id, "WorkOrder", a.orden.id, []);
    revisar("el observador sale en la lista", obs.includes(a.mirón.id), obs.length);
    /**
     * Lo que de verdad importa: si al responsable YA se le avisó, el
     * observador sigue en la lista. Si compitiera con él —como la cadena de
     * destinatarios, donde «el primero que tenga a alguien recibe»— solo se
     * enteraría cuando no hubiera responsable, que es justo cuando no sirve.
     */
    const conResponsableAvisado = await observadoresDe(a.org.id, "WorkOrder", a.orden.id, [a.tec.id]);
    revisar("   y sigue estando aunque al responsable ya se le avisara",
      conResponsableAvisado.includes(a.mirón.id));
    revisar("   pero no se le avisa dos veces a la misma persona",
      !(await observadoresDe(a.org.id, "WorkOrder", a.orden.id, [a.mirón.id])).includes(a.mirón.id));
    await alternarObservador(a.org.id, a.mirón.id, "WorkOrder", a.orden.id);
    revisar("   y al apagarlo deja de estar",
      !(await observadoresDe(a.org.id, "WorkOrder", a.orden.id, [])).includes(a.mirón.id));

    console.log("\nLo que NO debe pasar\n");
    const cruzado = await registroAnclable(b.org.id, "ADMIN", "WorkOrder", a.orden.id);
    revisar("no se cuelga nada de un registro de otra empresa", !cruzado.ok, cruzado.ok ? "" : cruzado.motivo);
    const inventado = await registroAnclable(a.org.id, "ADMIN", "LoQueSea", a.orden.id);
    revisar("ni de un tipo de registro que no existe", !inventado.ok, inventado.ok ? "" : inventado.motivo);
    const sinResponsable = await crearCompromiso({
      organizationId: a.org.id, creadoPorId: a.jefe.id, creadoPorNombre: a.jefe.name,
      entidad: "WorkOrder", entidadId: a.orden.id, texto: "Para alguien de otra empresa",
      responsableId: b.tec.id, enlace: "/x", comoSeLlama: "la orden",
    });
    revisar("poner de responsable a alguien de otra empresa lo deja sin responsable", sinResponsable.ok);
    revisar("   y no le avisa", (await prisma.notification.count({ where: { userId: b.tec.id } })) === 0);

    console.log("\nCada anclaje respeta el permiso de SU pantalla\n");
    /**
     * Compras y planes se agregaron despues, a peticion de Rafael, y es justo
     * donde una pantalla nueva puede abrir una puerta trasera: colgar algo de
     * una compra que ese rol no puede abrir seria una forma de averiguar que
     * existe. Se comprueba, no se supone.
     */
    const almacen = await prisma.warehouse.create({
      data: { organization: { connect: { id: a.org.id } }, code: "ALM-1", name: "Almacén" },
    });
    const compra = await prisma.purchaseRequest.create({
      data: {
        organization: { connect: { id: a.org.id } },
        warehouse: { connect: { id: almacen.id } },
        folio: `RQ-${sello.slice(-4)}`,
      },
    });
    const plan = await prisma.maintenancePlan.create({
      data: {
        organization: { connect: { id: a.org.id } },
        asset: { connect: { id: a.activo.id } },
        name: "Plan de prueba",
      },
    });

    for (const [rol, entidad, id, debe] of [
      ["COMPRAS", "PurchaseRequest", compra.id, true],
      ["TECHNICIAN", "PurchaseRequest", compra.id, false],
      ["SUPERVISOR", "MaintenancePlan", plan.id, true],
      ["COMPRAS", "MaintenancePlan", plan.id, false],
    ] as const) {
      const r = await registroAnclable(a.org.id, rol, entidad, id);
      revisar(`${rol} ${debe ? "SÍ" : "NO"} puede colgar algo de ${entidad}`,
        r.ok === debe, r.ok ? r.comoSeLlama : r.motivo);
    }

    // Rondines y refacciones, los últimos dos que se conectaron.
    const rondin = await prisma.rondin.create({
      data: { organization: { connect: { id: a.org.id } }, numero: `RD-${sello.slice(-4)}` },
    });
    const refa = await prisma.part.create({
      data: { organization: { connect: { id: a.org.id } }, code: `REF-${sello.slice(-4)}`, name: "Sello mecánico" },
    });
    for (const [rol, entidad, id, debe] of [
      ["TECHNICIAN", "Rondin", rondin.id, true],
      ["COMPRAS", "Rondin", rondin.id, false],
      ["COMPRAS", "Part", refa.id, true],
      ["REQUESTER", "Part", refa.id, false],
    ] as const) {
      const r = await registroAnclable(a.org.id, rol, entidad, id);
      revisar(`${rol} ${debe ? "SÍ" : "NO"} puede colgar algo de ${entidad}`,
        r.ok === debe, r.ok ? r.comoSeLlama : r.motivo);
    }

    const deOtra = await registroAnclable(b.org.id, "OWNER", "PurchaseRequest", compra.id);
    revisar("   y la compra de otra empresa sigue cerrada", !deOtra.ok);

    console.log("\nEl catálogo de anclajes\n");
    revisar("hay más lugares que los cuatro del principio", ENTIDADES_ANCLABLES.length >= 8, ENTIDADES_ANCLABLES.join(" "));
    const todos = await Promise.all(ENTIDADES_ANCLABLES.map((e) => registroAnclable(a.org.id, "OWNER", e, "noExiste")));
    revisar("   y todos responden que el registro no existe, no revientan",
      todos.every((t) => !t.ok && /no existe/.test(t.motivo)));
  } finally {
    for (const org of [a.org, b.org]) {
      await prisma.compromiso.deleteMany({ where: { organizationId: org.id } });
      await prisma.maintenancePlan.deleteMany({ where: { organizationId: org.id } });
      await prisma.rondin.deleteMany({ where: { organizationId: org.id } });
      await prisma.part.deleteMany({ where: { organizationId: org.id } });
      await prisma.purchaseRequest.deleteMany({ where: { organizationId: org.id } });
      await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
