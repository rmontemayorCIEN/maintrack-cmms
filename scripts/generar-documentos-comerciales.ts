/**
 * Genera los documentos comerciales que dependen de datos del producto:
 * planes y precios, comparación, preguntas frecuentes, historias de la demo,
 * presentación, SLA, política de soporte y los borradores legales.
 *
 *   npx tsx scripts/generar-documentos-comerciales.ts
 *
 * Salen de lib/comercial.ts, lib/planes.ts, lib/legal.ts y lib/demo-guia.ts:
 * las mismas fuentes que usan el sitio y la aplicación. Se vuelven a generar
 * cuando cambia un precio o un texto; nunca se editan a mano (llevan aviso).
 * `--revisar` solo compara y falla si están desactualizados (para el despliegue).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BENEFICIOS_POR_ROL, COBRO, DESCRIPCION, DIFERENCIADORES, LEMA, MARCA, MODULOS, NO_ES, PREGUNTAS, PROBLEMAS, PRUEBA_DIAS, SEGURIDAD, SEVERIDADES, SOPORTE, SUBLEMA, TEXTO_PRUEBA,
  comparacion, precio, textoCelda,
} from "../lib/comercial";
// Los tres complementos, iterados: agregar uno nuevo en planes.ts no obliga
// a tocar este generador.
import { COMPLEMENTO_IA, COMPLEMENTO_NORMAS, COMPLEMENTO_REGISTROS, NOMBRE_RECURSO, ORDEN_PLANES, PLANES } from "../lib/planes";
import { DOCUMENTOS, ESTADO_DOCUMENTOS, PENDIENTES, VERSION_DOCUMENTOS } from "../lib/legal";
import { HISTORIAS, ORDEN_RECOMENDADO, PASOS_RECORRIDO, PREGUNTAS_DEMO } from "../lib/demo-guia";
import { armarPresentacion, type Bloque } from "../lib/demo-presentacion";
import {
  CUANTOS, DE_QUIEN_ES_EL_ALMACEN, EL_ARGUMENTO_DE_FONDO, LAS_DOS_DIRECCIONES, LO_QUE_NO_HACE,
  LO_QUE_YA_HAY, POR_ERP, POR_QUE_ASI, POSTURA, PREGUNTAS_AL_AREA_DE_SISTEMAS,
} from "../lib/comercial-integraciones";
import { ALCANCES } from "../lib/integraciones/alcances";
import { ETIQUETA_MODULO, EVENTOS, EVENTOS_WEBHOOK, type Modulo } from "../lib/avisos/catalogo";
import { IMPORTACIONES, ORDEN_IMPORTACION } from "../lib/importacion";
import {
  COMO_SE_LLAMA_EL_ROL, elTamanoDelSistema, funcionesDeIa, pantallasInventariadas, pantallasPorRol,
} from "../lib/inventario";

const DIR = join("Docs", "comercial", "generados");
const AVISO = "<!-- Generado por scripts/generar-documentos-comerciales.ts. No se edita a mano: cambie la fuente y vuelva a generar. -->\n\n";
const lim = (n: number) => (n === Infinity ? "Sin límite" : n.toLocaleString("es-MX"));

const archivos: Record<string, string> = {};

archivos["planes-y-precios.md"] = `# Planes y precios de MainTrack

${ORDEN_PLANES.map((c) => {
  const p = PLANES[c];
  return `## ${p.nombre} — ${precio(p.precioMensual, p.moneda)} al mes

${p.descripcion}

| Límite | Valor |
|---|---|
${(Object.keys(p.limites) as Array<keyof typeof p.limites>).map((r) => `| ${NOMBRE_RECURSO[r][0].toUpperCase()}${NOMBRE_RECURSO[r].slice(1)} | ${lim(p.limites[r])} |`).join("\n")}

Incluye:
${p.incluye.map((x) => `- ${x}`).join("\n")}
`;
}).join("\n")}
${[COMPLEMENTO_IA, COMPLEMENTO_REGISTROS, COMPLEMENTO_NORMAS].map((c) => `
## Complemento ${c.nombre} — ${precio(c.precioMensual, c.moneda)} al mes

${c.descripcion}

${c.incluye.map((x) => `- ${x}`).join("\n")}
`).join("")}

## Condiciones

- **Periodicidad:** ${COBRO.periodicidad}. **Moneda:** ${COBRO.moneda}. ${COBRO.impuestos}
- **Periodo de prueba:** ${TEXTO_PRUEBA} (${PRUEBA_DIAS} días). ${COBRO.prueba}
- **Cobro:** ${COBRO.manual}
- **Cambio de plan:** ${COBRO.cambioDePlan}
- **Cancelación:** ${COBRO.cancelacion}
- **Soporte incluido:** ${SOPORTE.canal}; ${SOPORTE.horario} Tiempos objetivo en el Acuerdo de niveles de servicio.
- ${COBRO.demo}

## Comparación

| Grupo | Concepto | ${ORDEN_PLANES.map((p) => PLANES[p].nombre).join(" | ")} |
|---|---|${ORDEN_PLANES.map(() => "---").join("|")}|
${comparacion().map((f) => `| ${f.grupo} | ${f.concepto} | ${ORDEN_PLANES.map((p) => textoCelda(f.celdas[p])).join(" | ")} |`).join("\n")}
`;

archivos["propuesta-de-valor.md"] = `# Propuesta de valor

> ${DESCRIPCION}

**Mensaje principal:** ${LEMA}
**Mensaje secundario:** ${SUBLEMA}

## Cinco problemas y la respuesta de MainTrack

| Problema | Qué pasa hoy | Respuesta | Con qué |
|---|---|---|---|
${PROBLEMAS.map((p) => `| ${p.problema} | ${p.detalle} | ${p.respuesta} | ${p.capacidades.join("; ")} |`).join("\n")}

## Diferenciadores

${DIFERENCIADORES.map((d) => `- **${d.titulo}.** ${d.texto}`).join("\n")}

## Módulos

${MODULOS.map((m) => `- **${m.nombre}:** ${m.texto}`).join("\n")}

## Beneficios por rol

${BENEFICIOS_POR_ROL.map((b) => `- **${b.rol}:** ${b.beneficio}`).join("\n")}

## Qué no es

${NO_ES.map((x) => `- ${x}`).join("\n")}
`;

archivos["preguntas-frecuentes.md"] = `# Preguntas frecuentes

${PREGUNTAS.map((q) => `## ${q.p}\n\n${q.r}\n`).join("\n")}`;

archivos["historias-demo.md"] = `# Historias de la demostración

Se muestran en la **empresa demostrativa**, sobre el sistema real. Orden recomendado para 20 a 30 minutos: ${ORDEN_RECOMENDADO.map((k) => HISTORIAS.find((h) => h.clave === k)!.titulo).join(" → ")}.

${ORDEN_RECOMENDADO.map((k, i) => {
  const h = HISTORIAS.find((x) => x.clave === k)!;
  return `## ${i + 1}. ${h.titulo} (${h.minutos} min)

- **Rol:** ${h.rol}
- **Inicio:** ${h.inicio}
- **Problema:** ${h.problema}

${h.pasos.map((p, n) => `${n + 1}. ${p}`).join("\n")}

**Resultado que se explica:** ${h.resultado}

**Registros:** ${h.registros.map((r) => `${r.etiqueta} (${r.clave})`).join(", ")}
`;
}).join("\n")}
## Recorrido guiado (dentro de la demo)

${PASOS_RECORRIDO.map((p, i) => `${i + 1}. **${p.titulo}** — ${p.pantalla} (\`${p.href}\`): ${p.texto}`).join("\n")}

## Preguntas de quien presenta

${PREGUNTAS_DEMO.map((q) => `- **${q.p}** ${q.r}`).join("\n")}

## Restaurar la demo

Dentro de la demo: **Guía de la demostración › Restaurar la demo** (dirección o gerencia), escribiendo RESTAURAR. Fuera de ella:
\`npx tsx scripts/empresa-demostrativa.ts --restaurar\` (ensayo) y \`--restaurar --aplicar\`; en producción, a través de \`./scripts/con-produccion.sh\`.
Se conservan la empresa y las cuentas; todo lo demás vuelve a su estado inicial con fechas al día y queda en la auditoría.
`;

/**
 * La presentación no se escribe dos veces.
 *
 * La que vale es la que se proyecta dentro de MainTrack
 * (`lib/demo-presentacion.ts`); esto la baja a documento para quien la quiera
 * leer o imprimir. Escribirla aparte era garantizar que un día la diapositiva
 * dijera un precio y el documento otro.
 */
const enMarkdown = (b: Bloque): string => {
  switch (b.tipo) {
    case "parrafo": return b.texto;
    case "puntos": return b.items.map((x) => `- ${x}`).join("\n");
    case "tarjetas": return b.items.map((x) => `- **${x.titulo}:** ${x.texto}${x.pie ? ` (${x.pie})` : ""}`).join("\n");
    case "pasos": return b.items.map((x, i) => `${i + 1}. **${x.titulo}:** ${x.texto}`).join("\n");
    case "cambio": return b.items.map((x) => `- **${x.antes}.** ${x.detalle} → *${x.despues}*: ${x.capacidades.join(", ")}.`).join("\n");
    case "destacado": return `**${b.titulo}:** ${b.texto}`;
    case "planes": return b.items.map((x) => `- **${x.nombre}** — ${x.precio}. ${x.descripcion}${x.nota ? ` ${x.nota}` : ""}\n${x.incluye.map((y) => `  - ${y}`).join("\n")}`).join("\n");
    case "filas": return b.items.map((x) => `- **${x.etiqueta}:** ${x.texto}`).join("\n");
  }
};
const DIAPOSITIVAS = armarPresentacion();
archivos["presentacion.md"] = `# MainTrack — presentación comercial

> ${DIAPOSITIVAS.length} diapositivas, las mismas que se proyectan en **Guía de la demostración › Presentar al cliente** (\`/demo/presentacion\`, dentro de la empresa demostrativa), donde además abren las pantallas reales. Formato: una diapositiva por sección separada por \`---\` (compatible con Marp).

${DIAPOSITIVAS.map((d, i) => [
  `---`,
  ``,
  `## ${i + 1}. ${d.titulo}`,
  ``,
  `*${d.seccion}${d.rol ? ` · se muestra como: ${d.rol}` : ""}${d.minutos ? ` · ${d.minutos} min` : ""}*`,
  ...(d.entradilla ? ["", d.entradilla] : []),
  ...d.bloques.flatMap((b) => ["", enMarkdown(b)]),
  ...(d.ligas?.length ? ["", `Abrir en el sistema: ${d.ligas.map((l) => `${l.etiqueta} (\`${l.href}\`)`).join(" · ")}`] : []),
  ...(d.nota ? ["", `> **Quien presenta:** ${d.nota}`] : []),
  ``,
].join("\n")).join("\n")}`;

for (const d of DOCUMENTOS) {
  archivos[join("legal", `${d.clave}.md`)] = `# ${d.titulo}

> **${ESTADO_DOCUMENTOS}** Versión ${VERSION_DOCUMENTOS}. ${PENDIENTES}

${d.secciones.map((s) => `## ${s.titulo}\n\n${s.parrafos.join("\n\n")}\n`).join("\n")}`;
}
archivos["sla-resumen.md"] = `# Niveles de servicio — resumen

${SOPORTE.horario} Canal: ${SOPORTE.canal}.

| Severidad | Cuándo | Respuesta objetivo Professional | Respuesta objetivo Enterprise | Actualización |
|---|---|---|---|---|
${SEVERIDADES.map((s) => `| ${s.nombre} | ${s.cuando} | ${s.respuesta.PROFESSIONAL} | ${s.respuesta.ENTERPRISE} | ${s.actualizacion} |`).join("\n")}

${SOPORTE.disponibilidad}

El texto completo está en legal/sla.md y legal/soporte.md.
`;

/**
 * Integraciones: el documento que se manda antes de la junta cuando el cliente
 * dijo el nombre de su ERP.
 *
 * Los datos duros salen del codigo —los permisos de `alcances.ts`, los eventos
 * del catalogo de avisos, los tipos de carga de `importacion.ts`—, no de una
 * lista escrita aqui. Un permiso nuevo aparece en el documento sin que nadie lo
 * recuerde; era la unica forma de que no mintiera a los seis meses.
 */
const porModulo = EVENTOS_WEBHOOK.reduce<Partial<Record<Modulo, string[]>>>((acc, t) => {
  const m = EVENTOS[t].modulo;
  (acc[m] ??= []).push(EVENTOS[t].titulo);
  return acc;
}, {});

archivos["integraciones.md"] = `# MainTrack y su ERP

> ${POSTURA}

## Por qué así y no con un conector

${POR_QUE_ASI.map((x) => `- ${x}`).join("\n")}

## Las dos direcciones

**${LAS_DOS_DIRECCIONES.entra.titulo}**

${LAS_DOS_DIRECCIONES.entra.items.map((x) => `- ${x}`).join("\n")}

**${LAS_DOS_DIRECCIONES.sale.titulo}**

${LAS_DOS_DIRECCIONES.sale.items.map((x) => `- ${x}`).join("\n")}

## Lo que ya está hecho

Nada de esta sección es un plan: está en producción hoy.

${LO_QUE_YA_HAY.map((x) => `### ${x.titulo}\n\n${x.texto}`).join("\n\n")}

## Los ${CUANTOS.alcances} permisos que se le pueden dar a una llave

El cliente elige uno por uno. Lo que no marque, no existe para ese sistema externo.

| Permiso | Qué habilita |
|---|---|
${(Object.keys(ALCANCES) as Array<keyof typeof ALCANCES>).map((k) => `| \`${k}\` | ${ALCANCES[k]} |`).join("\n")}

## Los ${CUANTOS.eventos} eventos que MainTrack puede avisar

Cada webhook elige cuáles recibe. Van firmados, con reintentos y con historial de entrega.

${(Object.keys(porModulo) as Modulo[]).map((m) => `- **${ETIQUETA_MODULO[m]}:** ${porModulo[m]!.join(", ")}.`).join("\n")}

## Lo que entra por archivo

Para el arranque, y para lo que no valga la pena automatizar. Cada tipo se valida en seco antes de escribir, y el lote completo se puede revertir.

${ORDEN_IMPORTACION.map((k) => `- **${IMPORTACIONES[k].titulo}** — ${IMPORTACIONES[k].descripcion}`).join("\n")}

## ${DE_QUIEN_ES_EL_ALMACEN.pregunta}

${DE_QUIEN_ES_EL_ALMACEN.porQueImporta}

${DE_QUIEN_ES_EL_ALMACEN.opciones.map((o) => `### ${o.titulo}${o.recomendado ? " — recomendada" : ""}\n\n${o.texto}\n\n- **A favor:** ${o.aFavor}\n- **En contra:** ${o.enContra}`).join("\n\n")}

${DE_QUIEN_ES_EL_ALMACEN.enLaPractica}

## Qué esperar de cada ERP

${POR_ERP.map((e) => `### ${e.erp} — ${e.dificultad}\n\n${e.texto}${e.ojo ? `\n\n**Ojo:** ${e.ojo}` : ""}`).join("\n\n")}

## Lo que hay que preguntarle a su área de sistemas

Sin estas respuestas no hay alcance, y sin alcance no hay cotización.

${PREGUNTAS_AL_AREA_DE_SISTEMAS.map((x, i) => `${i + 1}. ${x}`).join("\n")}

## Lo que MainTrack no hace

${LO_QUE_NO_HACE.map((x) => `- ${x}`).join("\n")}

## ${EL_ARGUMENTO_DE_FONDO.titulo}

${EL_ARGUMENTO_DE_FONDO.texto}

---

La referencia técnica de la API —rutas, cuerpos, códigos de error y ejemplos— está en \`Docs/api-v1.md\`, y el índice vivo en \`GET /api/v1\` de la instalación del cliente.
`;

/**
 * Inventario de funcionalidad: todo lo que el sistema tiene y que hace.
 *
 * Cada renglon sale de donde vive la verdad —el menu, las 51 fichas de ayuda,
 * el registro de funciones de IA, los permisos de la API— y por eso `--revisar`
 * lo cuida: si se agrega una pantalla y no se regenera, el despliegue avisa.
 * Un inventario escrito a mano describe a los dos meses un sistema que ya no
 * existe.
 */
const TAMANO = elTamanoDelSistema();
const GRUPOS = pantallasInventariadas();

archivos["funcionalidad.md"] = `# ${MARCA} — todo lo que hace

> ${DESCRIPCION}

**${TAMANO.pantallas} pantallas** en ${TAMANO.grupos} grupos · **${TAMANO.funcionesDeIa} funciones de inteligencia artificial** · **${TAMANO.roles} roles** · API con ${TAMANO.permisosDeApi} permisos y ${TAMANO.eventosDeWebhook} eventos.

Este documento dice lo que el sistema TIENE, no lo que cada empresa ya trae capturado: tener la función y tenerla en marcha son cosas distintas.

## Qué es

${MODULOS.map((m) => `- **${m.nombre}:** ${m.texto}`).join("\n")}

## Qué no es

${NO_ES.map((x) => `- ${x}`).join("\n")}

## Cada pantalla, y qué se hace en ella

${GRUPOS.map((g) => `### ${g.seccion}

${g.pantallas.map((p) => [
  `**${p.etiqueta}** — ${p.que}`,
  p.hacer.length ? p.hacer.map((h) => `  - ${h}`).join("\n") : null,
].filter(Boolean).join("\n")).join("\n\n")}`).join("\n\n")}

## Cuántas pantallas ve cada quien

Nadie ve todo. El menú se arma según el rol, así que un solicitante entra a un sistema de seis pantallas y un técnico a uno de veinte: no hay que enseñarles lo que no van a usar.

| Rol | Pantallas |
|---|---|
${pantallasPorRol().map((r) => `| ${COMO_SE_LLAMA_EL_ROL[r.rol]} | ${r.cuantas} |`).join("\n")}

Además, cada persona puede poner sus pantallas de diario hasta arriba de su menú, sin cambiarle el menú a nadie más.

## Lo que hace la inteligencia artificial

Interpreta y redacta sobre los datos de la empresa. **No hace la aritmética**: disponibilidad, cumplimiento, costos, MTBF y MTTR los calcula el sistema y cada indicador muestra su fórmula; la IA lee esos números ya resueltos.

| Función | Qué hace | Operaciones |
|---|---|---|
${funcionesDeIa().map((f) => `| ${f.nombre} | ${f.descripcion} | ${f.operaciones} |`).join("\n")}

## Cómo se conecta con otros sistemas

${LO_QUE_YA_HAY.map((x) => `- **${x.titulo}:** ${x.texto}`).join("\n")}

El detalle está en \`integraciones.md\`, y la referencia técnica en \`Docs/api-v1.md\`.

## Cómo entra la información al arrancar

${ORDEN_IMPORTACION.map((k) => `- **${IMPORTACIONES[k].titulo}** — ${IMPORTACIONES[k].descripcion}`).join("\n")}

## Seguridad y respaldo

${SEGURIDAD.map((x) => `- ${x}`).join("\n")}
`;

const revisar = process.argv.includes("--revisar");
const distintos: string[] = [];
for (const [nombre, contenido] of Object.entries(archivos)) {
  const ruta = join(DIR, nombre);
  const texto = AVISO + contenido.replace(/\n{3,}/g, "\n\n");
  if (revisar) {
    if (!existsSync(ruta) || readFileSync(ruta, "utf8") !== texto) distintos.push(nombre);
    continue;
  }
  mkdirSync(join(ruta, ".."), { recursive: true });
  writeFileSync(ruta, texto);
}
if (revisar) {
  if (distintos.length) { console.error(`Documentos comerciales desactualizados: ${distintos.join(", ")}. Corra npx tsx scripts/generar-documentos-comerciales.ts`); process.exit(1); }
  console.log("✓ Documentos comerciales al día");
} else console.log(`✓ ${Object.keys(archivos).length} documentos en ${DIR}`);
