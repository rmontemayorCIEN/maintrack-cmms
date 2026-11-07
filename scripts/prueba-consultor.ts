/**
 * Prueba del Consultor del Sistema en Maintrack.
 *
 * Llama a las MISMAS funciones que la pantalla y las rutas (lib/consultor/),
 * con una puerta de IA simulada: nunca llama al modelo. Cubre el caso nuevo
 * (plan, preguntas, notas), el viejo (menu y favoritos sin el Consultor, la
 * puesta en marcha con su mismo porcentaje) y lo que no debe pasar (fuera de
 * tema que llega a redactar, datos personales a la IA, otra empresa, roles sin
 * permiso, solo lectura). Fecha fija: no depende del dia en que corra.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { prisma } from "../lib/db";
import { puestaEnMarcha, type Paso } from "../lib/puesta-en-marcha";
import { pasoDeArranque, pasosDeOperacion, planDe } from "../lib/consultor/plan";
import {
  activarConsultorDe, apagarNotaDe, arrancarDe, datosConsultor, fichasPara, guardarNotaDe, inicioDelDia, limpiarMensajes, preguntarDe, restaurarNotaDe,
  type Quien,
} from "../lib/consultor/consultor";
import type { PuertaIA } from "../consultor/consultar";
import { menuDe, puedeVerRuta } from "../lib/pantallas";
import { pantallasAnclables } from "../lib/favoritos";
import { PLANES } from "../lib/planes";
import { can } from "../lib/rbac";
import { AYUDA } from "../lib/ayuda";

const AHORA = new Date("2026-11-10T18:00:00Z"); // 12:00 en Monterrey

const paso = (x: Partial<Paso>): Paso => ({
  clave: "x", numero: 1, titulo: "X", que: "Algo", porQue: "Porque", estado: "EN_PROCESO", progreso: null, falta: "", problemas: [],
  enlace: "/settings", textoEnlace: "Abrir", peso: 2, ...x,
} as Paso);

async function main() {
  // --- La copia del paquete comun no se edito a mano.
  execFileSync("node", ["consultor/huella.mjs", "consultor", "--revisar"], { stdio: "pipe" });

  // --- La puesta en marcha en el idioma del Consultor.
  assert.equal(pasoDeArranque(paso({ estado: "COMPLETO" })).estado, "HECHO");
  assert.equal(pasoDeArranque(paso({ estado: "OPCIONAL" })).estado, "NO_APLICA");
  assert.equal(pasoDeArranque(paso({ estado: "NO_APLICA" })).estado, "NO_APLICA");
  assert.equal(pasoDeArranque(paso({ estado: "EN_PROCESO", progreso: { hecho: 0, meta: 5 } })).estado, "FALTA", "nada hecho es falta");
  assert.equal(pasoDeArranque(paso({ estado: "EN_PROCESO", progreso: { hecho: 2, meta: 5 } })).estado, "EN_PROCESO");
  const corregir = pasoDeArranque(paso({ estado: "CORREGIR", problemas: ["Dos activos sin sitio.", "Uno repetido."] }));
  assert.ok(corregir.estado === "EN_PROCESO" && corregir.falta.includes("sin sitio") && corregir.soloAdmin && corregir.etapa === "ARRANQUE");

  const sinOperar = pasosDeOperacion({ ordenesCerradas: 9, preventivasGeneradas: 9, solicitudes: 9 }, false);
  assert.ok(sinOperar.every((p) => p.estado === "FALTA" && /comenzar a operar|empieza a operar/.test(p.falta) && p.peso === 0), "antes de operar no cuenta nada");
  const operando = pasosDeOperacion({ ordenesCerradas: 1, preventivasGeneradas: 0, solicitudes: 3 }, true);
  assert.deepEqual(operando.map((p) => p.estado), ["HECHO", "FALTA", "HECHO"]);
  assert.ok([...sinOperar].every((p) => AYUDA[p.enlace]), "cada paso manda a una pantalla con ayuda");

  // --- Lo viejo sigue igual: el menu sin el Consultor, y con el, solo si se enciende.
  const enMenu = (o: { consultorActivo?: boolean }) => menuDe("OWNER", o).some((g) => g.items.some((i) => i.href === "/consultor"));
  assert.ok(!enMenu({}) && !enMenu({ consultorActivo: false }) && enMenu({ consultorActivo: true }));
  assert.ok(!pantallasAnclables("OWNER", {}).some((i) => i.href === "/consultor") && pantallasAnclables("OWNER", { consultorActivo: true }).some((i) => i.href === "/consultor"));
  assert.ok(menuDe("OWNER", {}).some((g) => g.items.some((i) => i.href === "/soporte")), "Soporte sigue en su lugar");
  for (const clave of Object.keys(PLANES) as (keyof typeof PLANES)[]) {
    assert.ok(PLANES[clave].ia.funciones.includes("CONSULTOR") && PLANES[clave].ia.bolsas.CONSULTOR > 0, `${clave} trae el Consultor con su bolsa`);
  }
  assert.ok(can("REQUESTER", "consultor:use") && !can("VIEWER", "consultor:use"), "consulta ve, no conversa");

  // --- El dia es el de la empresa.
  assert.equal(inicioDelDia(new Date("2026-11-11T05:30:00Z"), "America/Monterrey").toISOString(), "2026-11-10T06:00:00.000Z");

  // --- En la base.
  const sello = `cons-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" } });
  const otra = await prisma.organization.create({ data: { name: `${sello}-otra`, slug: `${sello}-otra`, plan: "PROFESSIONAL", status: "ACTIVE" } });
  const crear = async (name: string, role: string, orgId = org.id): Promise<Quien> => {
    const u = await prisma.user.create({ data: { organizationId: orgId, email: `${role.toLowerCase()}-${name.length}-${sello}@t.mx`, name, role, passwordHash: "x" } });
    return { userId: u.id, nombre: name, orgId, rol: role, esOperador: false, soloLectura: false };
  };
  try {
    const duena = await crear("Dueña Prueba", "OWNER");
    const tecnico = await crear("Beto Técnico", "TECHNICIAN");
    const consulta = await crear("Vera Consulta", "VIEWER");
    const solicitante = await crear("Sol Solicita", "REQUESTER");
    const ajena = await crear("Fuera", "OWNER", otra.id);

    // Un criterio, un lugar: el porcentaje es el de la puesta en marcha.
    const plan = await planDe(org.id, "OWNER");
    assert.equal(plan.porcentaje, (await puestaEnMarcha(org.id)).porcentaje);
    assert.equal(plan.pasos.filter((p) => p.etapa === "ARRANQUE").length, plan.marcha.pasos.length);
    const delSolicitante = await planDe(org.id, "REQUESTER");
    assert.ok(!delSolicitante.pasos.some((p) => p.etapa === "OPERACION" && (p.enlace === "/work-orders" || p.enlace === "/plans")), "lo de operación que no puede abrir no aparece");
    assert.ok(delSolicitante.pasos.filter((p) => !puedeVerRuta("REQUESTER", p.enlace)).every((p) => p.soloAdmin), "lo que no puede abrir es de la administración, y el panel no lo enlaza");
    assert.ok(fichasPara({ rol: "REQUESTER", esOperador: false }).every((f) => puedeVerRuta("REQUESTER", f.ruta)) && !fichasPara({ rol: "REQUESTER", esOperador: false }).some((f) => f.ruta === "/billing"));

    // Apagado de fabrica; solo la administracion lo enciende, con bitacora.
    const apagado = await datosConsultor(tecnico, AHORA);
    assert.ok(!apagado.activo && !apagado.puedeActivar);
    const nunca: PuertaIA = { clasificar: async () => assert.fail("no debio llamar a la IA"), redactar: async () => assert.fail("no debio llamar a la IA") };
    assert.ok(!(await preguntarDe(duena, "¿Qué sigue?", null, { ahora: AHORA, ia: nunca })).ok, "apagado no pregunta");
    const sinPermiso = await activarConsultorDe(tecnico, true);
    assert.ok(!sinPermiso.ok && /administra/.test(sinPermiso.error));
    assert.ok((await activarConsultorDe(duena, true)).ok);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: org.id, summary: "Encendió el Consultor del Sistema" } }), 1);
    assert.ok(!(await datosConsultor(ajena, AHORA)).activo, "encenderlo en una empresa no lo enciende en otra");

    const d = await datosConsultor(duena, AHORA);
    assert.ok(d.activo && d.porcentaje === plan.porcentaje && d.quedanHoy === 40 && d.puedeAdministrar);

    // Caso nuevo: una pregunta del sistema se redacta, se guarda y recuerda donde se quedo.
    const llamadas: string[] = [];
    const vistas: string[] = [];
    const instrucciones: string[] = [];
    const puerta = (clase: string): PuertaIA => ({
      clasificar: async ({ pregunta }) => { llamadas.push("clasificar"); vistas.push(pregunta); return clase; },
      redactar: async ({ sistema, pregunta, contexto }) => {
        llamadas.push("redactar"); vistas.push(pregunta, contexto); instrucciones.push(sistema);
        return { respuesta: "Le falta dar de alta sus sitios.", enlace: "/settings", pasoClave: "sitios", resumen: "Vimos los sitios.", notasPropuestas: [{ tipo: "FECHA", texto: "Quiere operar el 1 de diciembre" }] };
      },
    });
    const r = await preguntarDe(tecnico, "¿Qué falta? Habla Dueña Prueba, mi correo es duena@x.com y mi cel 81 1234 5678, OT 4512", "/dashboard", { ahora: AHORA, ia: puerta("IMPLEMENTACION") });
    assert.ok(r.ok && r.contestacion.notasPropuestas.length === 1 && r.quedan === 39);
    assert.deepEqual(llamadas, ["clasificar", "redactar"]);
    assert.ok(vistas.every((x) => !x.includes("duena@x.com") && !x.includes("1234 5678") && !x.includes("Dueña")), "la IA nunca vio correo, teléfono ni nombre");
    assert.ok(vistas.some((x) => x.includes("OT 4512")), "lo que no es dato personal se queda");
    assert.ok(vistas.some((x) => x.includes(`AVANCE: ${plan.porcentaje} %`)), "el contexto lleva el porcentaje de la puesta en marcha");
    assert.ok(instrucciones.some((x) => x.includes("de usted")), "las instrucciones piden hablar de usted");
    const guardados = await prisma.consultorMensaje.findMany({ where: { organizationId: org.id, userId: tecnico.userId }, orderBy: { creadoEn: "asc" } });
    assert.ok(guardados.length === 2 && guardados[0].texto.includes("[correo]") && guardados[1].clase === "IMPLEMENTACION");
    const est = await prisma.consultorEstado.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: tecnico.userId } } });
    assert.ok(est?.pasoActual === "sitios" && est.resumen === "Vimos los sitios.");

    // Lo que no debe pasar: fuera de tema y consejo de experto nunca llegan a redactar.
    llamadas.length = 0;
    const fuera = await preguntarDe(tecnico, "¿Quién ganó el clásico?", null, { ahora: AHORA, ia: puerta("FUERA_DE_TEMA") });
    assert.ok(fuera.ok && /Solo puedo ayudarle con MainTrack/.test(fuera.contestacion.respuesta));
    const consejo = await preguntarDe(tecnico, "¿Qué falla tiene mi compresor?", null, { ahora: AHORA, ia: puerta("CONSEJO_EXPERTO") });
    assert.ok(consejo.ok && /no doy consejo de ingeniería/.test(consejo.contestacion.respuesta));
    assert.deepEqual(llamadas, ["clasificar", "clasificar"]);

    // Roles y solo lectura: consulta ve el plan pero no conversa.
    const dc = await datosConsultor(consulta, AHORA);
    assert.ok(dc.activo && dc.soloLectura);
    assert.ok(!(await preguntarDe(consulta, "hola", null, { ahora: AHORA, ia: nunca })).ok);
    assert.ok(!(await guardarNotaDe({ ...duena, soloLectura: true }, "META", "Otra")).ok, "cuenta vencida no escribe");
    assert.ok((await datosConsultor(solicitante, AHORA)).activo);

    // La conversacion es de cada persona.
    const dd = await datosConsultor(duena, AHORA);
    assert.ok(dd.activo && dd.mensajes.length === 0);

    // Tope diario.
    await prisma.consultorMensaje.createMany({ data: Array.from({ length: 37 }, () => ({ organizationId: org.id, userId: tecnico.userId, de: "USUARIO", texto: "x", creadoEn: AHORA })) });
    const tope = await preguntarDe(tecnico, "¿Y ahora?", null, { ahora: AHORA, ia: nunca });
    assert.ok(!tope.ok && /40 preguntas/.test(tope.error));
    assert.ok((await preguntarDe(tecnico, "¿Y ahora?", null, { ahora: new Date("2026-11-11T18:00:00Z"), ia: puerta("OPERACION") })).ok, "al dia siguiente se reinicia");

    // Notas: validadas, de la empresa, con permisos y Deshacer.
    const n1 = await guardarNotaDe(tecnico, "FECHA", "Quiere operar el 1 de diciembre");
    assert.ok(n1.ok);
    assert.ok(!(await guardarNotaDe(duena, "FECHA", "quiere operar el 1 de DICIEMBRE")).ok, "repetida");
    const malas = await guardarNotaDe(tecnico, "OTRO", "");
    assert.ok(!malas.ok && /no existe/.test(malas.error) && /vacía/.test(malas.error));
    const n2 = await guardarNotaDe(duena, "EQUIPO", "Dueña Prueba y dos técnicos");
    assert.ok(n2.ok && n2.nota.texto.includes("{persona}"));
    if (!n1.ok || !n2.ok) throw new Error("sin notas");
    assert.ok(!(await apagarNotaDe(tecnico, n2.nota.id)).ok, "el técnico no apaga la nota de la dueña");
    assert.ok(!(await apagarNotaDe(ajena, n1.nota.id)).ok, "otra empresa no la encuentra");
    assert.ok((await apagarNotaDe(duena, n1.nota.id)).ok, "la administración sí");
    assert.equal(await prisma.consultorNota.count({ where: { id: n1.nota.id } }), 1, "apagar no borra");
    assert.ok((await restaurarNotaDe(tecnico, n1.nota.id)).ok);

    // Entrevista de usted.
    const ent = await arrancarDe(solicitante, {}, AHORA);
    assert.ok(!ent.ok && /Conteste/.test(ent.error));
    assert.ok((await arrancarDe(solicitante, { meta: "Que no se pierdan los reportes" }, AHORA)).ok);

    // Retencion: 180 dias y nada mas.
    const viejo = await prisma.consultorMensaje.create({ data: { organizationId: org.id, userId: tecnico.userId, de: "USUARIO", texto: "viejo", creadoEn: new Date("2026-05-01T12:00:00Z") } });
    assert.ok((await limpiarMensajes(AHORA)) >= 1);
    assert.equal(await prisma.consultorMensaje.count({ where: { id: viejo.id } }), 0);
    assert.ok((await prisma.consultorMensaje.count({ where: { organizationId: org.id } })) >= 40, "lo reciente se queda");

    // Apagar no borra nada.
    assert.ok((await activarConsultorDe(duena, false)).ok);
    assert.ok((await prisma.consultorNota.count({ where: { organizationId: org.id } })) >= 3);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: otra.id } }).catch(() => undefined);
  }
  // Se va con la empresa: borrar la empresa borra su memoria (cascada).
  assert.equal(await prisma.consultorNota.count({ where: { organizationId: org.id } }), 0);
  assert.equal(await prisma.consultorMensaje.count({ where: { organizationId: org.id } }), 0);

  console.log("consultor: plan de la puesta en marcha, menú, activación, preguntas, tema, privacidad, roles, tope, notas y retención en verde");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
