/**
 * Registros propios: las tablas que arma el cliente.
 *
 * Llama a las MISMAS funciones que usan la API y las pantallas; no replica sus
 * pasos. Lo que mas vigila, en orden de lo que costaria mas caro:
 *
 *   · que una referencia a los datos de OTRA empresa se rechace,
 *   · que un dato que apunta a algo borrado diga «ya no existe» y no un guion,
 *   · que renombrar un campo NO pierda lo ya capturado,
 *   · que cambiar el tipo de un campo con datos no se pueda,
 *   · que el folio sea por tabla y no global,
 *   · que VIEWER no pueda capturar y una cuenta vencida tampoco.
 *
 *   npx tsx scripts/prueba-registros.ts
 */
import { prisma } from "../lib/db";
import {
  actualizarCampo, actualizarRenglon, agregarCampo, crearDePlantilla, crearTabla,
  guardarRenglon, leerRenglones, listarTablas, puedeVerTabla, registrosDelReferido,
  renglonesParaIa, resumenParaIa, revisarCaptura, tablaPorClave, totalesDe,
} from "../lib/registros";
import {
  LIMITES, claveDesde, claveLibre, interpretarValor, opcionesDe,
  problemasDeDefinicion, textoDeOpciones,
} from "../lib/registros-tipos";
import { PLANTILLAS } from "../lib/registros-plantillas";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
}

const cuenta = (status: string, trialEndsAt: Date | null = null) =>
  ({ status, plan: "ENTERPRISE", trialEndsAt });

async function main() {
  console.log("\n1. La definicion se valida antes de tocar la base\n");
  revisar("una tabla sin nombre se rechaza",
    problemasDeDefinicion({ nombre: "", descripcion: "x", campos: [{ etiqueta: "A", tipo: "TEXTO" }] }).length > 0);
  revisar("una tabla SIN explicacion se rechaza (la lee la IA)",
    problemasDeDefinicion({ nombre: "Tabla", descripcion: "  ", campos: [{ etiqueta: "A", tipo: "TEXTO" }] })
      .some((p) => p.includes("Explique")));
  revisar("una tabla sin campos se rechaza",
    problemasDeDefinicion({ nombre: "Tabla", descripcion: "Para algo", campos: [] }).length > 0);
  revisar("dos campos con el mismo nombre se rechazan",
    problemasDeDefinicion({ nombre: "T", descripcion: "d", campos: [{ etiqueta: "Litros", tipo: "NUMERO" }, { etiqueta: "litros", tipo: "TEXTO" }] })
      .some((p) => p.includes("se llaman igual")));
  revisar("una lista con una sola opcion se rechaza",
    problemasDeDefinicion({ nombre: "T", descripcion: "d", campos: [{ etiqueta: "Estado", tipo: "LISTA", opciones: "Uno" }] })
      .some((p) => p.includes("al menos dos")));
  revisar("un tipo inventado se rechaza",
    problemasDeDefinicion({ nombre: "T", descripcion: "d", campos: [{ etiqueta: "X", tipo: "COLOR" }] })
      .some((p) => p.includes("tipo que no existe")));

  console.log("\n2. Las claves son estables y no se pisan\n");
  revisar("los acentos y espacios salen de la clave", claveDesde("Lectura del horómetro") === "lectura_del_horometro", claveDesde("Lectura del horómetro"));
  revisar("una clave ocupada se numera", claveLibre("litros", ["litros"]) === "litros_2");
  revisar("las opciones viajan por renglon, no por coma",
    JSON.stringify(opcionesDe(textoDeOpciones(["Aceite 15W40, tambo", "Grasa"]))) === JSON.stringify(["Aceite 15W40, tambo", "Grasa"]));

  console.log("\n3. Interpretar lo capturado\n");
  const num = { clave: "litros", etiqueta: "Litros", tipo: "NUMERO" };
  const r1 = interpretarValor(num, "1,250.50");
  revisar("un numero con coma de miles se entiende", r1.ok && r1.valor.numero === 1250.5, r1.ok ? r1.valor.numero : r1);
  const r2 = interpretarValor(num, "$ 300");
  revisar("un importe con signo de pesos se entiende", r2.ok && r2.valor.numero === 300);
  revisar("un numero que no es numero se rechaza", !interpretarValor(num, "mucho").ok);
  revisar("un campo obligatorio vacio se rechaza", !interpretarValor({ ...num, requerido: true }, "").ok);
  revisar("un campo opcional vacio pasa y queda nulo", interpretarValor(num, "").ok);
  const lista = { clave: "e", etiqueta: "Estado", tipo: "LISTA", opciones: "Nueva\nUsada" };
  revisar("una opcion fuera de la lista se rechaza", !interpretarValor(lista, "Rota").ok);
  revisar("una opcion de la lista pasa", interpretarValor(lista, "Usada").ok);
  const largo = interpretarValor({ clave: "t", etiqueta: "Nota", tipo: "TEXTO" }, "x".repeat(300));
  revisar("un texto mas largo que el limite se RECHAZA, no se recorta callado",
    !largo.ok && (largo as { motivo: string }).motivo.includes("300"));
  revisar("«si» con acento se entiende como si", (() => { const v = interpretarValor({ clave: "b", etiqueta: "Cumple", tipo: "SI_NO" }, "sí"); return v.ok && v.valor.booleano === true; })());

  console.log("\n4. Las plantillas estan bien formadas\n");
  for (const p of PLANTILLAS) {
    const problemas = problemasDeDefinicion({
      nombre: p.nombre, descripcion: p.descripcion,
      campos: p.campos.map((c) => ({ etiqueta: c.etiqueta, tipo: c.tipo, opciones: c.opciones ? textoDeOpciones(c.opciones) : null })),
    });
    revisar(`«${p.nombre}» es una definicion valida`, problemas.length === 0, problemas);
  }

  const sello = `prueba-reg-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE", registrosPropios: true } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", registrosPropios: true } });

  try {
    const quien = await prisma.user.create({
      data: { organizationId: A.id, email: `u${Date.now()}@x.com`, name: "Supervisor", passwordHash: "x", role: "SUPERVISOR" },
    });
    const sitioA = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "S1", name: "Planta ajena" } });
    const equipoA = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitioA.id, code: "GEN-1", name: "Generador" } });
    const equipoB = await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "GEN-9", name: "Generador ajeno" } });
    const efimero = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitioA.id, code: "TMP-1", name: "Equipo que se borra" } });

    console.log("\n5. Armar una tabla\n");
    const alta = await crearTabla(A.id, {
      nombre: "Bitácora de diésel",
      descripcion: "Cada carga de diésel a un equipo, con litros e importe.",
      campos: [
        { etiqueta: "Equipo", tipo: "ACTIVO", requerido: true },
        { etiqueta: "Fecha", tipo: "FECHA", requerido: true },
        { etiqueta: "Litros", tipo: "NUMERO", requerido: true },
        { etiqueta: "Importe", tipo: "DINERO" },
        { etiqueta: "Turno", tipo: "LISTA", opciones: ["Matutino", "Vespertino", "Nocturno"] },
        { etiqueta: "Nota", tipo: "TEXTO" },
      ],
    }, quien.id);
    revisar("la tabla se dio de alta", alta.ok, alta.ok ? undefined : alta.motivos);
    if (!alta.ok) throw new Error("sin tabla no hay prueba");
    const tabla = alta.dato;
    revisar("la clave sale del nombre, sin acentos", tabla.clave === "bitacora_de_diesel", tabla.clave);
    revisar("quedaron los seis campos", tabla.campos.length === 6);

    const repetida = await crearTabla(A.id, { nombre: "Bitácora de diésel", descripcion: "Otra igual.", campos: [{ etiqueta: "X", tipo: "TEXTO" }] }, quien.id);
    revisar("una segunda tabla con el mismo nombre obtiene clave propia",
      repetida.ok && repetida.dato.clave === "bitacora_de_diesel_2", repetida.ok ? repetida.dato.clave : repetida.motivos);

    console.log("\n6. Capturar\n");
    const ok1 = await guardarRenglon(A.id, tabla.id, {
      equipo: equipoA.id, fecha: "2026-09-01", litros: "120.5", importe: "3,150.00", turno: "Matutino", nota: "Tanque al tope",
    }, quien.id);
    revisar("un renglon completo se guarda", ok1.ok, ok1.ok ? ok1.dato : ok1.motivos);
    revisar("el primer folio es 1", ok1.ok && ok1.dato.folio === 1);

    const ok2 = await guardarRenglon(A.id, tabla.id, { equipo: equipoA.id, fecha: "2026-09-08", litros: "98", importe: "2,600" }, quien.id);
    revisar("el segundo folio es 2", ok2.ok && ok2.dato.folio === 2);

    const faltaObligatorio = await guardarRenglon(A.id, tabla.id, { fecha: "2026-09-02", litros: "10" }, quien.id);
    revisar("sin el campo obligatorio se rechaza con motivo en español",
      !faltaObligatorio.ok && faltaObligatorio.motivos.some((m) => m.includes("Equipo")), faltaObligatorio.ok ? undefined : faltaObligatorio.motivos);

    const vacio = await guardarRenglon(A.id, tabla.id, {}, quien.id);
    revisar("un renglon sin nada no se guarda", !vacio.ok);

    console.log("\n7. Cada empresa ve solo lo suyo\n");
    const ajeno = await guardarRenglon(A.id, tabla.id, { equipo: equipoB.id, fecha: "2026-09-03", litros: "50" }, quien.id);
    revisar("un equipo de OTRA empresa se rechaza",
      !ajeno.ok && ajeno.motivos.some((m) => m.includes("no existe en esta empresa")), ajeno.ok ? undefined : ajeno.motivos);

    const enOtra = await guardarRenglon(B.id, tabla.id, { equipo: equipoB.id, fecha: "2026-09-03", litros: "50" }, quien.id);
    revisar("no se puede capturar en la tabla de otra empresa", !enOtra.ok);

    const soloDeA = await listarTablas(A.id);
    const soloDeB = await listarTablas(B.id);
    revisar("la otra empresa no ve las tablas de esta", soloDeB.length === 0 && soloDeA.length === 2, { A: soloDeA.length, B: soloDeB.length });

    console.log("\n8. Leer, con las referencias resueltas\n");
    const conCampos = (await tablaPorClave(A.id, tabla.clave))!;
    const leido = await leerRenglones(A.id, conCampos);
    revisar("se leen los dos renglones", leido.renglones.length === 2, leido.total);
    revisar("el folio mas nuevo va primero", leido.renglones[0].folio === 2);
    const primero = leido.renglones.find((r) => r.folio === 1)!;
    revisar("el equipo se muestra con su codigo y nombre", primero.valores.equipo.texto === "GEN-1 — Generador", primero.valores.equipo.texto);
    revisar("el importe se muestra con separadores", primero.valores.importe.texto === "3,150.00", primero.valores.importe.texto);
    revisar("el numero se guarda como numero, para poder sumarlo", typeof primero.valores.litros.crudo === "number");
    revisar("quien capturo queda registrado", primero.capturoNombre === "Supervisor");

    const totales = totalesDe(conCampos, leido.renglones);
    revisar("los litros se suman en TypeScript", Math.abs(totales.litros.suma - 218.5) < 0.001, totales.litros);
    revisar("el importe se suma", Math.abs(totales.importe.suma - 5750) < 0.001, totales.importe);
    revisar("las columnas de texto no traen total", totales.nota === undefined);

    console.log("\n9. Una referencia que ya no existe LO DICE\n");
    const conEfimero = await guardarRenglon(A.id, tabla.id, { equipo: efimero.id, fecha: "2026-09-10", litros: "5" }, quien.id);
    revisar("se captura contra el equipo que luego se borra", conEfimero.ok);
    await prisma.asset.delete({ where: { id: efimero.id } });
    const trasBorrar = await leerRenglones(A.id, conCampos);
    const huerfano = trasBorrar.renglones.find((r) => r.folio === (conEfimero.ok ? conEfimero.dato.folio : -1))!;
    revisar("dice «ya no existe», no un guion", huerfano.valores.equipo.texto === "ya no existe", huerfano.valores.equipo.texto);
    revisar("y queda marcado para que la pantalla lo pinte distinto", huerfano.valores.equipo.referenciaPerdida === true);

    console.log("\n10. Renombrar NO pierde lo capturado\n");
    const campoLitros = conCampos.campos.find((c) => c.clave === "litros")!;
    const renombrado = await actualizarCampo(A.id, campoLitros.id, { etiqueta: "Litros cargados" }, quien.id);
    revisar("el campo se renombra", renombrado.ok);
    revisar("la clave NO cambia", renombrado.ok && renombrado.dato.clave === "litros", renombrado.ok ? renombrado.dato.clave : undefined);
    const trasRenombrar = await leerRenglones(A.id, (await tablaPorClave(A.id, tabla.clave))!);
    const sigue = trasRenombrar.renglones.find((r) => r.folio === 1)!;
    revisar("los valores siguen ahi despues de renombrar", sigue.valores.litros.crudo === 120.5, sigue.valores.litros);

    console.log("\n11. Quitar una opcion que ya se uso se avisa\n");
    const campoTurno = conCampos.campos.find((c) => c.clave === "turno")!;
    const quitando = await actualizarCampo(A.id, campoTurno.id, { opciones: ["Vespertino", "Nocturno"] }, quien.id);
    revisar("se rechaza porque «Matutino» ya esta capturado",
      !quitando.ok && quitando.motivos.some((m) => m.includes("Matutino")), quitando.ok ? undefined : quitando.motivos);
    const agregando = await actualizarCampo(A.id, campoTurno.id, { opciones: ["Matutino", "Vespertino", "Nocturno", "Mixto"] }, quien.id);
    revisar("agregar una opcion si se puede", agregando.ok, agregando.ok ? undefined : agregando.motivos);

    console.log("\n12. Actualizar un renglon\n");
    const r1id = leido.renglones.find((r) => r.folio === 1)!.id;
    const editado = await actualizarRenglon(A.id, r1id, { litros: "130" }, quien.id);
    revisar("se actualiza un solo campo", editado.ok, editado.ok ? undefined : editado.motivos);
    const trasEditar = await leerRenglones(A.id, (await tablaPorClave(A.id, tabla.clave))!);
    const editadoLeido = trasEditar.renglones.find((r) => r.folio === 1)!;
    revisar("el campo cambio", editadoLeido.valores.litros.crudo === 130, editadoLeido.valores.litros.crudo);
    revisar("lo que NO se mando no se borro", editadoLeido.valores.nota.texto === "Tanque al tope", editadoLeido.valores.nota.texto);
    const editarAjeno = await actualizarRenglon(B.id, r1id, { litros: "1" }, quien.id);
    revisar("no se edita el renglon de otra empresa", !editarAjeno.ok);

    console.log("\n13. Donde aparece un equipo\n");
    const donde = await registrosDelReferido(A.id, "asset", equipoA.id);
    revisar("el equipo aparece en la bitacora", donde.length === 1 && donde[0].renglones.length === 2, donde.map((d) => ({ t: d.tabla.nombre, n: d.renglones.length })));
    const dondeAjeno = await registrosDelReferido(B.id, "asset", equipoA.id);
    revisar("desde la otra empresa no aparece nada", dondeAjeno.length === 0);

    console.log("\n14. Permisos y estado de la cuenta\n");
    revisar("VIEWER no ve una tabla restringida a mando",
      !puedeVerTabla("VIEWER", { rolesVer: "OWNER,ADMIN,SUPERVISOR" }));
    revisar("VIEWER si ve una tabla abierta a todos",
      puedeVerTabla("VIEWER", { rolesVer: "OWNER,ADMIN,SUPERVISOR,TECHNICIAN,VIEWER" }));
    const viva = { nombre: "T", permiso: "workorder:execute", activa: true };
    revisar("VIEWER no puede capturar (no tiene ningun permiso, por construccion)",
      revisarCaptura({ role: "VIEWER", organization: cuenta("ACTIVE") }, viva).ok === false);
    revisar("el tecnico si puede capturar en una tabla de campo",
      revisarCaptura({ role: "TECHNICIAN", organization: cuenta("ACTIVE") }, viva).ok === true);
    revisar("el tecnico NO puede en una tabla de administracion",
      revisarCaptura({ role: "TECHNICIAN", organization: cuenta("ACTIVE") }, { ...viva, permiso: "settings:write" }).ok === false);
    const suspendida = revisarCaptura({ role: "ADMIN", organization: cuenta("SUSPENDED") }, viva);
    revisar("una cuenta suspendida no captura, aunque el rol alcance",
      !suspendida.ok && suspendida.estado === 402, suspendida.ok ? undefined : suspendida);
    const vencida = revisarCaptura({ role: "ADMIN", organization: cuenta("TRIAL", new Date(Date.now() - 86_400_000)) }, viva);
    revisar("una prueba vencida tampoco", !vencida.ok);
    revisar("una tabla apagada se consulta pero no se captura",
      revisarCaptura({ role: "ADMIN", organization: cuenta("ACTIVE") }, { ...viva, activa: false }).ok === false);


    console.log("\n18. Lo que la IA entrega, y lo que NO\n");
    // Una tabla que solo ve administracion: es el caso que importa, porque la
    // IA no puede ser la puerta de atras para leerla.
    const contable = await crearTabla(A.id, {
      nombre: "Contratos de servicio",
      descripcion: "Los contratos con terceros y lo que se les paga al mes.",
      permiso: "settings:write",
      rolesVer: ["OWNER", "ADMIN"],
      campos: [
        { etiqueta: "Objeto", tipo: "TEXTO", requerido: true },
        { etiqueta: "Importe mensual", tipo: "DINERO" },
        { etiqueta: "Litros incluidos", tipo: "NUMERO" },
      ],
    }, quien.id);
    revisar("la tabla restringida se dio de alta", contable.ok, contable.ok ? undefined : contable.motivos);
    if (contable.ok) {
      await guardarRenglon(A.id, contable.dato.id, { objeto: "Vigilancia", importe_mensual: "48,000", litros_incluidos: "200" }, quien.id);

      const comoAdmin = await resumenParaIa(A.id, { rol: "ADMIN" });
      revisar("administracion ve la tabla restringida", comoAdmin.some((t) => t.nombre === "Contratos de servicio"));
      const comoTecnico = await resumenParaIa(A.id, { rol: "TECHNICIAN" });
      revisar("el tecnico NO la ve en el catalogo que recibe la IA",
        !comoTecnico.some((t) => t.nombre === "Contratos de servicio"),
        comoTecnico.map((t) => t.nombre));

      const leidoAdmin = await renglonesParaIa(A.id, contable.dato.clave, { rol: "ADMIN" });
      revisar("administracion si lee sus renglones", !("error" in leidoAdmin));
      const leidoTecnico = await renglonesParaIa(A.id, contable.dato.clave, { rol: "TECHNICIAN" });
      revisar("al tecnico se le niega con motivo, no con datos", "error" in leidoTecnico, leidoTecnico);

      // El dinero viaja bajo «costos» para que la depuracion por rol de
      // lib/ia/herramientas.ts lo quite: el patron /costo/ pega en esa clave.
      if (!("error" in leidoAdmin)) {
        const r = leidoAdmin.renglones[0];
        revisar("el importe NO viaja entre los valores normales", r.valores.importe_mensual === undefined, r.valores);
        revisar("el importe viaja apartado, bajo «costos»", r.costos?.importe_mensual === "48,000.00", r.costos);
        revisar("una cantidad que no es dinero si va en los valores", r.valores.litros_incluidos === "200");
        revisar("las sumas de dinero van bajo «costos», no bajo «sumas»",
          leidoAdmin.sumas["Importe mensual"] === undefined && leidoAdmin.costos["Importe mensual"]?.suma === 48000,
          { sumas: Object.keys(leidoAdmin.sumas), costos: Object.keys(leidoAdmin.costos) });
      }

      revisar("una tabla que no existe se niega con motivo",
        "error" in (await renglonesParaIa(A.id, "no_existe", { rol: "ADMIN" })));
    }

    console.log("\n15. Los limites\n");
    const conCampoMas = await agregarCampo(A.id, tabla.id, { etiqueta: "Proveedor", tipo: "PROVEEDOR" }, quien.id);
    revisar("se puede agregar un campo", conCampoMas.ok, conCampoMas.ok ? undefined : conCampoMas.motivos);
    revisar("agregar un campo con nombre repetido se rechaza",
      !(await agregarCampo(A.id, tabla.id, { etiqueta: "Fecha", tipo: "FECHA" }, quien.id)).ok);

    // Se llena hasta el tope de tablas para ver que la numero trece se detenga.
    let creadas = 2;
    while (creadas < LIMITES.tablasPorEmpresa) {
      const r = await crearTabla(A.id, { nombre: `Relleno ${creadas}`, descripcion: "De relleno para probar el tope.", campos: [{ etiqueta: "Dato", tipo: "TEXTO" }] }, quien.id);
      if (!r.ok) break;
      creadas++;
    }
    const pasada = await crearTabla(A.id, { nombre: "Una mas", descripcion: "La que ya no cabe.", campos: [{ etiqueta: "Dato", tipo: "TEXTO" }] }, quien.id);
    revisar(`con ${LIMITES.tablasPorEmpresa} tablas activas, la siguiente se rechaza`,
      !pasada.ok && pasada.motivos.some((m) => m.includes("límite")), pasada.ok ? undefined : pasada.motivos);

    console.log("\n16. Lo que la IA alcanza a leer\n");
    const resumen = await resumenParaIa(A.id);
    const bitacora = resumen.find((t) => t.nombre === "Bitácora de diésel")!;
    revisar("la IA ve para que es la tabla", Boolean(bitacora?.paraQueEs?.includes("diésel")));
    revisar("la IA ve las columnas con su tipo", bitacora.columnas.some((c) => c.nombre === "Equipo" && c.tipo === "ACTIVO"));
    revisar("la IA ve las opciones de una lista", (bitacora.columnas.find((c) => c.nombre === "Turno") as { opciones?: string[] })?.opciones?.includes("Matutino") === true);

    console.log("\n17. Alta desde plantilla\n");
    const C = await prisma.organization.create({ data: { name: `${sello}-c`, slug: `${sello}-c`, plan: "ENTERPRISE", registrosPropios: true } });
    try {
      const dePlantilla = await crearDePlantilla(C.id, "epp", null);
      revisar("la plantilla de equipo de proteccion se da de alta", dePlantilla.ok, dePlantilla.ok ? undefined : dePlantilla.motivos);
      revisar("trae sus campos", dePlantilla.ok && dePlantilla.dato.campos.length > 5);
      revisar("y trae la explicacion ya escrita", dePlantilla.ok && dePlantilla.dato.descripcion.length > 40);
      revisar("una plantilla que no existe se rechaza", !(await crearDePlantilla(C.id, "inventada", null)).ok);
    } finally {
      await prisma.organization.delete({ where: { id: C.id } });
    }
  } finally {
    await prisma.organization.delete({ where: { id: A.id } });
    await prisma.organization.delete({ where: { id: B.id } });
  }

  console.log(fallos === 0 ? "\n✓ Todo pasa\n" : `\n✗ ${fallos} fallas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
