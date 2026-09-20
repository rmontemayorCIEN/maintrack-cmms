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
  BENEFICIOS_POR_ROL, COBRO, DESCRIPCION, DIFERENCIADORES, LEMA, MODULOS, NO_ES, PREGUNTAS, PROBLEMAS, PRUEBA_DIAS, SEVERIDADES, SOPORTE, SUBLEMA, TEXTO_PRUEBA,
  comparacion, precio, textoCelda,
} from "../lib/comercial";
import { COMPLEMENTO_IA, NOMBRE_RECURSO, ORDEN_PLANES, PLANES } from "../lib/planes";
import { DOCUMENTOS, ESTADO_DOCUMENTOS, PENDIENTES, VERSION_DOCUMENTOS } from "../lib/legal";
import { HISTORIAS, ORDEN_RECOMENDADO, PASOS_RECORRIDO, PREGUNTAS_DEMO } from "../lib/demo-guia";
import { armarPresentacion, type Bloque } from "../lib/demo-presentacion";

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
## Complemento ${COMPLEMENTO_IA.nombre} — ${precio(COMPLEMENTO_IA.precioMensual, COMPLEMENTO_IA.moneda)} al mes

${COMPLEMENTO_IA.descripcion}

${COMPLEMENTO_IA.incluye.map((x) => `- ${x}`).join("\n")}

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
