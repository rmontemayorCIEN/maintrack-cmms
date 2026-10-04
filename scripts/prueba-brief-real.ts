/**
 * El parte del dia, llamando al modelo DE VERDAD.
 *
 * Cuesta centavos y no va en el despliegue. Lo que comprueba es lo unico que
 * no se puede comprobar en seco: que la redaccion real respete las cifras del
 * guion, y que cuando NO las respete el sistema la deseche sola.
 *
 * Corre contra la base LOCAL; lo unico de produccion es la llave, que se trae
 * de Secret Manager sin imprimirla:
 *
 *   ANTHROPIC_API_KEY="$(CLOUDSDK_CORE_PROJECT=maintrack-cmms-4821 \
 *     gcloud secrets versions access latest --secret=cmms-anthropic-key)" \
 *     npx tsx scripts/prueba-brief-real.ts
 */
import { prisma } from "../lib/db";
import { borrarEmpresaDesechable, crearEmpresaDesechable } from "./empresa-desechable";
import { guionDelDia } from "../lib/brief";
import { cifrasInventadas, redactarBrief } from "../lib/ia/brief";
import { iaConfigurada } from "../lib/ia/cliente";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

const DIA = 86_400_000;
const ZONA = "America/Monterrey";

async function main() {
  if (!iaConfigurada()) {
    console.log("\n  Sin ANTHROPIC_API_KEY: esta prueba llama al modelo y no puede correr.");
    console.log("  Traiga la llave de Secret Manager (ver el encabezado del archivo).\n");
    process.exit(1);
  }

  const creadas: string[] = [];

  try {
    const { org, sello } = await crearEmpresaDesechable("briefreal-", {
      timezone: ZONA, diasHabiles: "1,2,3,4,5", currency: "MXN",
      // El complemento encendido: sin el, redactarBrief se cae al guion
      // plano y esta prueba no probaria nada del modelo.
      iaComplemento: true,
    });
    creadas.push(org.id);
    const site = await prisma.site.create({ data: { organizationId: org.id, code: "S1", name: "Planta" } });
    const nave = await prisma.location.create({ data: { organizationId: org.id, siteId: site.id, code: "NAVE", name: "Nave de producción" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: org.id, siteId: site.id, code: "ALM", name: "Almacén", esGeneral: true } });

    const director = await prisma.user.create({
      data: { organizationId: org.id, email: `dir-${sello}@prueba.mx`, name: "Ana Robles", role: "OWNER", passwordHash: "x" },
    });
    const otro = await prisma.user.create({
      data: { organizationId: org.id, email: `otro-${sello}@prueba.mx`, name: "Luis Peña", role: "SUPERVISOR", passwordHash: "x" },
    });

    const ahora = new Date();
    const caido = await prisma.asset.create({
      data: { organizationId: org.id, siteId: site.id, locationId: nave.id, code: "CMP-301", name: "Compresor de tornillo", status: "DOWN", criticality: "A" },
    });
    for (let i = 0; i < 7; i++) {
      await prisma.workOrder.create({
        data: {
          organizationId: org.id, number: `${sello}-${i}`, title: `Trabajo pendiente ${i}`,
          maintenanceType: "CORRECTIVE", status: "OPEN", assetId: caido.id,
          dueDate: new Date(ahora.getTime() - (i + 3) * DIA),
        },
      });
    }
    await prisma.predictiveAlert.create({
      data: { organizationId: org.id, assetId: caido.id, severity: "CRITICAL", title: "Temperatura de descarga", message: "x", status: "OPEN", createdAt: new Date(ahora.getTime() - 4 * DIA) },
    });
    await prisma.purchaseRequest.create({
      data: { organizationId: org.id, folio: `RC-${sello}`, estado: "SOLICITADA", solicitanteId: otro.id, warehouseId: almacen.id, montoEstimado: 128_400, createdAt: new Date(ahora.getTime() - 6 * DIA) },
    });

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: director.id }, include: { organization: true } });
    const guion = await guionDelDia(usuario as never, ahora);

    console.log("\nEl guion que se le entrega al modelo\n");
    for (const p of guion.puntos) console.log(`  · ${p.texto}`);
    console.log(`\n  cifras permitidas: ${guion.cifras.join(", ")}\n`);

    console.log("Lo que el modelo devolvió\n");
    const brief = await redactarBrief(usuario.organization as never, guion, { userId: director.id });
    console.log(`  «${brief.texto}»\n`);
    console.log(`  origen: ${brief.origen}${brief.motivo ? ` · ${brief.motivo}` : ""} · costo: ${brief.costoUsd.toFixed(5)} USD\n`);

    revisar("el modelo redactó (no se cayó al guion)", brief.origen === "ia", brief.motivo ?? "");
    revisar("no inventó ninguna cifra",
      cifrasInventadas(brief.texto, guion.cifras).length === 0,
      cifrasInventadas(brief.texto, guion.cifras).join(", ") || "ninguna");
    revisar("empieza saludando por su nombre", brief.texto.includes("Ana"), brief.texto.slice(0, 40));
    revisar("cabe en menos de cuarenta segundos hablados", brief.texto.length < 900, `${brief.texto.length} caracteres`);
    revisar("no trae viñetas ni encabezados: esto se lee en voz alta",
      !/^[-*#•]|\n[-*#•]/m.test(brief.texto), "sin marcas de lista");
    revisar("menciona el equipo caído", brief.texto.toLowerCase().includes("compresor"), "");
    revisar("se cobró como una operación", brief.costoUsd > 0, `${brief.costoUsd.toFixed(5)} USD`);

    // Lo que NO debe pasar: si el modelo trae una cifra de mas, el sistema la
    // caza y usa el guion. Se simula metiendo una cifra ajena al guion.
    console.log("\nLa red, con una redacción envenenada\n");
    const envenenado = `${brief.texto} El costo subió 37 por ciento este mes.`;
    revisar("una cifra que no estaba en el guion se detecta",
      cifrasInventadas(envenenado, guion.cifras).includes("37"),
      cifrasInventadas(envenenado, guion.cifras).join(", "));

    // ── Que no se pague dos veces el mismo parte ──────────────────────────
    //
    // El modelo redacta distinto el mismo parte cada vez, asi que guardar el
    // audio por el TEXTO no servia de nada: cada clic pagaba redaccion y
    // sintesis aunque no hubiera cambiado nada en la planta. Ahora se guarda
    // por los DATOS.
    console.log("\nEl mismo parte, otra vez\n");
    const otraVez = await redactarBrief(usuario.organization as never, guion, { userId: director.id });
    revisar("con los mismos datos dice exactamente lo mismo", otraVez.texto === brief.texto);
    revisar("y no se vuelve a cobrar", otraVez.costoUsd === 0, `$${otraVez.costoUsd.toFixed(5)}`);

    console.log("\nEn cuanto cambia algo en la planta\n");
    const conCambio = {
      ...guion,
      puntos: [...guion.puntos, { clave: "extra", peso: 9, texto: "Y se cayó otro equipo." }],
    };
    const rehecho = await redactarBrief(usuario.organization as never, conCambio as never, { userId: director.id });
    revisar("se rehace el parte, sin esperar a que venza ningún tiempo",
      rehecho.texto !== brief.texto, rehecho.texto.slice(0, 70));
    revisar("y esa sí se cobra", rehecho.costoUsd > 0, `$${rehecho.costoUsd.toFixed(5)}`);

    // Y que quede registrado el consumo, que es como se cobra.
    const usos = await prisma.aiUsage.count({ where: { organizationId: org.id, funcion: "BRIEF" } });
    revisar("el consumo quedó registrado en AiUsage", usos > 0, `${usos} registro(s)`);
  } finally {
    for (const id of creadas) {
      if (!(await borrarEmpresaDesechable(id))) fallas++;
    }
  }

  console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
