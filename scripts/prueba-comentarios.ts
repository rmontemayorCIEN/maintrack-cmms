/**
 * La conversación pegada al registro, de punta a punta contra la base real.
 *
 * Llama las MISMAS funciones que llaman las rutas —`crearComentario`,
 * `listarComentarios`, `registroComentable`, `eliminarComentario`— y no una
 * copia de sus pasos. Una prueba que replica el endpoint pasa mientras el
 * endpoint hace otra cosa; ya pasó en este proyecto con el alta de planes.
 *
 * Crea sus propias organizaciones, las ejercita y las borra al final.
 *
 *   npx tsx scripts/prueba-comentarios.ts
 */
import { prisma } from "../lib/db";
import {
  crearComentario, eliminarComentario, listarComentarios, registroComentable,
} from "../lib/comentarios";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function armarEmpresa(sello: string) {
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const jefe = await prisma.user.create({
    data: { organizationId: org.id, email: `jefe-${sello}@t.mx`, name: "Jefe de Prueba", role: "ADMIN", passwordHash: "x" },
  });
  const tecnico = await prisma.user.create({
    data: { organizationId: org.id, email: `tec-${sello}@t.mx`, name: "Tecnico de Prueba", role: "TECHNICIAN", passwordHash: "x" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
      code: "BMB-1", name: "Bomba", status: "OPERATIONAL",
    },
  });
  const orden = await prisma.workOrder.create({
    data: {
      organizationId: org.id, number: `OT-${sello.slice(-5)}`, title: "Orden de prueba",
      maintenanceType: "CORRECTIVE", status: "OPEN", assetId: activo.id, createdById: jefe.id,
    },
  });
  return { org, jefe, tecnico, activo, orden };
}

async function main() {
  const sello = `prueba-com-${Date.now()}`;
  const a = await armarEmpresa(sello);
  // Una SEGUNDA empresa: sin ella no se puede probar que no haya fuga, que es
  // lo único aquí que sería un problema de verdad.
  const b = await armarEmpresa(`${sello}-otra`);

  try {
    console.log("\nEscribir y leer\n");
    const r1 = await crearComentario({
      organizationId: a.org.id, autorId: a.jefe.id, autorNombre: a.jefe.name,
      ancla: "workOrder", anclaId: a.orden.id,
      texto: "  ¿Esta bomba lleva sello 6205 o 6206?  ",
      enlace: `/work-orders/${a.orden.id}`, comoSeLlama: "la orden de prueba",
    });
    revisar("se guarda un comentario", r1.ok);
    const lista = await listarComentarios(a.org.id, "workOrder", a.orden.id);
    revisar("y se lee en el registro", lista.length === 1, `${lista.length}`);
    revisar("   sin espacios de sobra", lista[0]?.texto === "¿Esta bomba lleva sello 6205 o 6206?", JSON.stringify(lista[0]?.texto));
    revisar("   con su autor", lista[0]?.autor?.name === a.jefe.name, lista[0]?.autor?.name);

    console.log("\nMencionar avisa, y a quien toca\n");
    await prisma.notification.deleteMany({ where: { organizationId: a.org.id } });
    await crearComentario({
      organizationId: a.org.id, autorId: a.jefe.id, autorNombre: a.jefe.name,
      ancla: "workOrder", anclaId: a.orden.id,
      texto: `@${a.tecnico.name} y @${a.jefe.name} lo vemos mañana`,
      menciones: [a.tecnico.id, a.jefe.id],
      enlace: `/work-orders/${a.orden.id}`, comoSeLlama: "la orden de prueba",
    });
    const avisos = await prisma.notification.findMany({
      where: { organizationId: a.org.id }, select: { userId: true, link: true },
    });
    revisar("sale UN aviso, no dos", avisos.length === 1, `${avisos.length}`);
    revisar("   y es para el mencionado", avisos[0]?.userId === a.tecnico.id);
    /**
     * Nombrarse a uno mismo no avisa. Pasa todo el tiempo al escribir «@Juan y
     * yo lo vemos mañana», y un aviso de algo que uno acaba de escribir es el
     * ruido que hace que la gente apague los avisos —y con ellos los que sí
     * importaban—.
     */
    revisar("   el autor NO se avisa a sí mismo", !avisos.some((x) => x.userId === a.jefe.id));
    revisar("   el aviso lleva a la orden", avisos[0]?.link === `/work-orders/${a.orden.id}`, avisos[0]?.link ?? "");

    console.log("\nBorrar deja marca, no hueco\n");
    const mio = (await listarComentarios(a.org.id, "workOrder", a.orden.id))[0];
    const ajeno = await eliminarComentario(a.org.id, mio.id, a.tecnico.id);
    revisar("otro no puede borrar lo que yo escribí", !ajeno.ok, ajeno.motivo ?? "");
    const propio = await eliminarComentario(a.org.id, mio.id, a.jefe.id);
    revisar("su autor sí", propio.ok);
    const tras = await listarComentarios(a.org.id, "workOrder", a.orden.id);
    revisar("   el comentario sigue en la lista, marcado", tras.length === 2 && Boolean(tras[0].eliminadoEl), `${tras.length}`);
    revisar("   y su texto ya no se sirve", tras[0].texto === "", JSON.stringify(tras[0].texto));

    console.log("\nLo que NO debe pasar\n");
    /**
     * La fuga entre empresas es el único defecto de esta lista que sería
     * grave. Se prueba con dos organizaciones de verdad, no suponiendo.
     */
    const ajena = await registroComentable(b.org.id, "ADMIN", "workOrder", a.orden.id);
    revisar("no se puede comentar una orden de otra empresa", !ajena.ok, ajena.ok ? "" : ajena.motivo);
    const propia = await registroComentable(a.org.id, "ADMIN", "workOrder", a.orden.id);
    revisar("   y la propia sí", propia.ok);
    revisar("   con su enlace y su nombre",
      propia.ok && propia.enlace === `/work-orders/${a.orden.id}` && propia.comoSeLlama.includes("OT-"),
      propia.ok ? propia.comoSeLlama : "");

    // Mencionar a alguien de otra empresa: se ignora en silencio, no revienta
    // ni le avisa. El id no se valida contra una lista: se busca dentro de la
    // organización, así que lo que no sea de ahí no existe.
    await prisma.notification.deleteMany({ where: { organizationId: a.org.id } });
    await crearComentario({
      organizationId: a.org.id, autorId: a.jefe.id, autorNombre: a.jefe.name,
      ancla: "workOrder", anclaId: a.orden.id, texto: "probando",
      menciones: [b.tecnico.id],
      enlace: `/work-orders/${a.orden.id}`, comoSeLlama: "la orden",
    });
    const fuga = await prisma.notification.count({ where: { userId: b.tecnico.id } });
    revisar("mencionar a alguien de otra empresa no le avisa", fuga === 0, `${fuga} aviso(s)`);
    const conFuga = await prisma.comentarioMencion.count({ where: { userId: b.tecnico.id } });
    revisar("   ni queda guardada la mención", conFuga === 0, `${conFuga}`);

    // Un rol que no ve la pantalla tampoco comenta ahí.
    const sinPermiso = await registroComentable(a.org.id, "REQUESTER", "materialRequest", "loQueSea");
    revisar("un rol que no ve requisiciones no comenta en ellas", !sinPermiso.ok,
      sinPermiso.ok ? "" : sinPermiso.motivo);

    console.log("\nLos comentarios se van con su registro\n");
    await prisma.workOrder.delete({ where: { id: a.orden.id } });
    const huerfanos = await prisma.comentario.count({ where: { organizationId: a.org.id } });
    revisar("borrar la orden se lleva su conversación", huerfanos === 0, `${huerfanos} quedaron`);
  } finally {
    for (const org of [a.org, b.org]) {
      await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
