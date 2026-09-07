import { prisma } from "../db";
import { computeKpis } from "../kpi";
import { analizarAlmacen } from "../almacen-analisis";
import { AYUDA, CONTROLES_TABLA } from "../ayuda";
import { agruparPorCodigo, fallasCodificadas } from "@/lib/fallas";

/**
 * Herramientas de consulta para la IA.
 *
 * El modelo no escribe SQL ni recibe acceso a la base: solo puede llamar estas
 * funciones, con estos parametros. La organizacion NUNCA viene del modelo —la
 * inyecta el servidor desde la sesion—, asi que ninguna pregunta, por astuta
 * que sea, puede alcanzar los datos de otro cliente.
 *
 * Todas son de lectura. No hay una sola que escriba, y esa ausencia es
 * deliberada: una consulta se responde, no ejecuta cambios.
 */

const DIA = 86_400_000;

function rango(dias?: number) {
  const to = new Date();
  const from = new Date(to.getTime() - (dias ?? 90) * DIA);
  return { from, to };
}

export const HERRAMIENTAS = [
  {
    // La unica herramienta que NO consulta datos del cliente sino como opera
    // el sistema. Existe para que la ayuda con IA se apoye en documentacion
    // curada en vez del conocimiento general del modelo sobre software de
    // mantenimiento: una IA que inventa botones que no existen destruye la
    // confianza mas rapido que no tener ayuda.
    name: "documentacion",
    description:
      "Como funciona una pantalla de MainTrack: que es, que se puede hacer, como se conecta con el resto, que significa cada campo, que hace cada boton, y por que el sistema puede negar una accion. Uselo SIEMPRE que la pregunta sea sobre como usar el sistema, donde esta algo, o por que no lo deja hacer algo. Sin ruta devuelve el indice de todas las pantallas.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruta: {
          type: "string",
          description:
            "Ruta de la pantalla: /work-orders, /plans, /assets, /inventory, /inventory/kardex, /inventory/conteos, /requisiciones, /compras, /suppliers, /settings, /catalogs, /calendar, /requests, /meters, /predictive, /alerts, /consulta, /diagnostico, /reports, /dashboard, /glossary, /puesta-en-marcha, /board. Omitala para ver el indice.",
        },
      },
    },
  },
  {
    name: "indicadores",
    description:
      "Indicadores de confiabilidad y costos del periodo: MTTR, MTBF, disponibilidad, cumplimiento preventivo, backlog, y el costo desglosado en mano de obra, refacciones, servicios externos y otros. Uselo para preguntas sobre desempeño general o costos totales.",
    input_schema: {
      type: "object" as const,
      properties: {
        dias: { type: "number", description: "Cuantos días hacia atrás. 30, 90, 180 o 365. Por omision 90." },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_ordenes",
    description:
      "Busca órdenes de trabajo y devuelve el conteo, el costo sumado, las horas y una muestra. Uselo para «cuantas órdenes», «cuanto costo», «que trabajos hubo en tal equipo».",
    input_schema: {
      type: "object" as const,
      properties: {
        dias: { type: "number", description: "Ventana hacia atrás en días. Por omision 90." },
        codigoActivo: { type: "string", description: "Código del activo, ej. CMP-301. Omitir para toda la planta." },
        tipo: { type: "string", enum: ["PREVENTIVE", "CORRECTIVE", "PREDICTIVE", "INSPECTION"] },
        estado: { type: "string", enum: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"] },
        soloVencidas: { type: "boolean", description: "Solo las que pasaron su fecha compromiso sin cerrarse." },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  {
    name: "costo_por_activo",
    description:
      "Los activos ordenados por lo que costaron en el periodo, con sus horas de paro y su número de órdenes. Uselo para «que equipo me cuesta mas», «cual da mas problemas».",
    input_schema: {
      type: "object" as const,
      properties: {
        dias: { type: "number", description: "Ventana hacia atrás en días. Por omision 365." },
        limite: { type: "number", description: "Cuantos devolver. Por omision 10." },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_activo",
    description:
      "Ficha completa de un equipo: datos, criticidad, planes, medidores, historial de fallas con codigos y causas raiz, y su costo acumulado.",
    input_schema: {
      type: "object" as const,
      properties: {
        codigo: { type: "string", description: "Código del activo, ej. CMP-301." },
      },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_almacen",
    description:
      "Estado del almacen: existencias, minimos, consumo, lo que esta por debajo de su minimo y lo que no se mueve. Acepta un texto para filtrar por codigo o nombre de refaccion.",
    input_schema: {
      type: "object" as const,
      properties: {
        buscar: { type: "string", description: "Texto para filtrar por código o nombre. Omitir para el panorama completo." },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  {
    name: "fallas_frecuentes",
    description:
      "Que fallas y que causas raiz se repiten mas, con su conteo. Uselo para «por que se para tanto», «cual es mi problema principal».",
    input_schema: {
      type: "object" as const,
      properties: {
        dias: { type: "number", description: "Ventana hacia atrás. Por omision 180." },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
];

/**
 * Ejecuta una herramienta. `organizationId` lo pone quien llama, desde la
 * sesion: es el unico parametro que el modelo no controla.
 */
export async function ejecutarHerramienta(
  organizationId: string,
  nombre: string,
  entrada: Record<string, unknown>,
): Promise<unknown> {
  const dias = typeof entrada.dias === "number" ? Math.min(1095, Math.max(1, entrada.dias)) : undefined;

  switch (nombre) {
    case "documentacion": {
      const ruta = typeof entrada.ruta === "string" ? entrada.ruta : null;
      if (!ruta || !AYUDA[ruta]) {
        return {
          nota: ruta ? `No hay documentacion para "${ruta}". Estas son las pantallas que si tienen.` : undefined,
          pantallas: Object.entries(AYUDA).map(([r, f]) => ({ ruta: r, titulo: f.titulo, que: f.que })),
        };
      }
      const f = AYUDA[ruta];
      return {
        ruta,
        titulo: f.titulo,
        que: f.que,
        queSePuedeHacer: f.hacer,
        comoSeConecta: f.flujo,
        campos: f.campos ?? [],
        botones: f.botones ?? [],
        // Los controles de lista se explican una sola vez y se anexan a las
        // pantallas que los usan, en vez de repetirlos en cada ficha.
        controlesDeLista: f.tablaConfigurable ? CONTROLES_TABLA : [],
        siElSistemaDiceQueNo: f.noPuedo ?? [],
        preguntasFrecuentes: f.preguntas ?? [],
      };
    }

    case "indicadores": {
      const k = await computeKpis(organizationId, rango(dias ?? 90));
      return {
        periodoDias: dias ?? 90,
        mttrHoras: Math.round(k.reliability.mttr * 10) / 10,
        mtbfHoras: Math.round(k.reliability.mtbf),
        disponibilidad: Math.round(k.reliability.availability * 100) / 100,
        cumplimientoPreventivo: Math.round(k.reliability.pmCompliance),
        trabajoPlanificado: Math.round(k.reliability.plannedRatio),
        horasParoNoPlaneado: Math.round(k.reliability.unplannedDowntimeMinutes / 60),
        ordenes: k.totals,
        costos: k.costs,
        porTipo: k.byType,
      };
    }

    case "buscar_ordenes": {
      const r = rango(dias ?? 90);
      const activo = typeof entrada.codigoActivo === "string" && entrada.codigoActivo
        ? await prisma.asset.findFirst({ where: { organizationId, code: entrada.codigoActivo }, select: { id: true, code: true, name: true } })
        : null;
      if (entrada.codigoActivo && !activo) return { error: `No existe el activo ${entrada.codigoActivo}` };

      const where = {
        organizationId,
        createdAt: { gte: r.from, lte: r.to },
        ...(activo ? { assetId: activo.id } : {}),
        ...(typeof entrada.tipo === "string" ? { maintenanceType: entrada.tipo } : {}),
        ...(typeof entrada.estado === "string" ? { status: entrada.estado } : {}),
        ...(entrada.soloVencidas
          ? { dueDate: { lt: new Date() }, status: { notIn: ["COMPLETED", "CLOSED", "CANCELLED"] } }
          : {}),
      };

      const [agregado, muestra] = await Promise.all([
        prisma.workOrder.aggregate({
          where, _count: { _all: true },
          _sum: { totalCost: true, actualHours: true, downtimeMinutes: true },
        }),
        prisma.workOrder.findMany({
          where,
          select: {
            number: true, title: true, status: true, maintenanceType: true, priority: true,
            totalCost: true, createdAt: true, asset: { select: { code: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 12,
        }),
      ]);

      return {
        filtro: { dias: dias ?? 90, activo: activo ? `${activo.code} ${activo.name}` : "toda la planta", tipo: entrada.tipo ?? null, estado: entrada.estado ?? null },
        total: agregado._count._all,
        costoSumado: Math.round(agregado._sum.totalCost ?? 0),
        horasSumadas: Math.round((agregado._sum.actualHours ?? 0) * 10) / 10,
        horasDeParo: Math.round((agregado._sum.downtimeMinutes ?? 0) / 60),
        muestra: muestra.map((w) => ({
          numero: w.number, titulo: w.title, activo: w.asset?.code ?? null,
          tipo: w.maintenanceType, estado: w.status, prioridad: w.priority,
          costo: Math.round(w.totalCost), fecha: w.createdAt.toISOString().slice(0, 10),
        })),
      };
    }

    case "costo_por_activo": {
      const r = rango(dias ?? 365);
      const limite = typeof entrada.limite === "number" ? Math.min(25, Math.max(1, entrada.limite)) : 10;
      const filas = await prisma.workOrder.groupBy({
        by: ["assetId"],
        where: { organizationId, assetId: { not: null }, createdAt: { gte: r.from, lte: r.to } },
        _sum: { totalCost: true, downtimeMinutes: true },
        _count: { _all: true },
      });
      const top = filas.sort((a, b) => (b._sum.totalCost ?? 0) - (a._sum.totalCost ?? 0)).slice(0, limite);
      const activos = await prisma.asset.findMany({
        where: { id: { in: top.map((t) => t.assetId!) } },
        select: { id: true, code: true, name: true, criticality: true, replacementCost: true },
      });
      return {
        periodoDias: dias ?? 365,
        activos: top.map((t) => {
          const a = activos.find((x) => x.id === t.assetId);
          const costo = Math.round(t._sum.totalCost ?? 0);
          return {
            activo: a ? `${a.code} ${a.name}` : "sin activo",
            criticidad: a?.criticality ?? null,
            costo,
            ordenes: t._count._all,
            horasDeParo: Math.round((t._sum.downtimeMinutes ?? 0) / 60),
            costoDeReemplazo: a?.replacementCost ?? null,
            proporcionDelReemplazo: a?.replacementCost ? Math.round((costo / a.replacementCost) * 100) : null,
          };
        }),
      };
    }

    case "consultar_activo": {
      const a = await prisma.asset.findFirst({
        where: { organizationId, code: String(entrada.codigo ?? "") },
        select: {
          code: true, name: true, manufacturer: true, model: true, criticality: true, status: true,
          purchaseDate: true, replacementCost: true,
          site: { select: { name: true } }, location: { select: { name: true } },
          category: { select: { name: true } },
          meters: { select: { name: true, unit: true, currentValue: true } },
          plans: { where: { active: true }, select: { name: true, intervalDays: true, nextDueDate: true } },
          workOrders: {
            select: {
              number: true, title: true, maintenanceType: true, status: true, totalCost: true,
              downtimeMinutes: true, createdAt: true,
              failureCode: { select: { code: true, description: true } },
              rootCause: { select: { description: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 15,
          },
        },
      });
      if (!a) return { error: `No existe el activo ${entrada.codigo}` };
      const totales = await prisma.workOrder.aggregate({
        where: { organizationId, asset: { code: String(entrada.codigo) } },
        _sum: { totalCost: true, downtimeMinutes: true }, _count: { _all: true },
      });
      return {
        ...a,
        purchaseDate: a.purchaseDate?.toISOString().slice(0, 10) ?? null,
        plans: a.plans.map((p) => ({ ...p, nextDueDate: p.nextDueDate?.toISOString().slice(0, 10) ?? null })),
        workOrders: a.workOrders.map((w) => ({ ...w, createdAt: w.createdAt.toISOString().slice(0, 10) })),
        acumulado: {
          ordenes: totales._count._all,
          costo: Math.round(totales._sum.totalCost ?? 0),
          horasDeParo: Math.round((totales._sum.downtimeMinutes ?? 0) / 60),
        },
      };
    }

    case "consultar_almacen": {
      const buscar = typeof entrada.buscar === "string" ? entrada.buscar.trim() : "";
      if (buscar) {
        const partes = await prisma.part.findMany({
          where: {
            organizationId,
            OR: [{ code: { contains: buscar } }, { name: { contains: buscar } }],
          },
          select: {
            code: true, name: true, unit: true, unitCost: true, quantityOnHand: true,
            minQuantity: true, category: true, supplier: { select: { name: true, leadTimeDays: true } },
          },
          take: 15,
        });
        return { encontradas: partes.length, refacciones: partes };
      }
      const a = await analizarAlmacen(organizationId);
      return {
        totales: a.totales,
        bajoMinimo: a.bajoMinimo.slice(0, 10),
        minimosAAjustar: a.minimosSugeridos.slice(0, 10),
        sinMovimiento: a.inmovilizado.slice(0, 10),
      };
    }

    case "fallas_frecuentes": {
      const r = rango(dias ?? 180);
      const [porCodigo, porCausa] = await Promise.all([
        fallasCodificadas(organizationId, r.from).then(agruparPorCodigo),
        prisma.workOrder.groupBy({
          by: ["rootCauseId"],
          where: { organizationId, rootCauseId: { not: null }, createdAt: { gte: r.from } },
          _count: { _all: true },
        }),
      ]);
      const [codigos, causas] = await Promise.all([
        prisma.failureCode.findMany({ where: { id: { in: porCodigo.map((x) => x.failureCodeId) } }, select: { id: true, code: true, description: true } }),
        prisma.rootCause.findMany({ where: { id: { in: porCausa.map((x) => x.rootCauseId!) } }, select: { id: true, description: true } }),
      ]);
      const sinCausa = await prisma.workOrder.count({
        where: { organizationId, status: { in: ["COMPLETED", "CLOSED"] }, rootCauseId: null, createdAt: { gte: r.from } },
      });
      return {
        periodoDias: dias ?? 180,
        fallas: porCodigo
          .map((f) => {
            const c = codigos.find((x) => x.id === f.failureCodeId);
            // El costo es el que se le cargo a esa falla, no el de la orden
            // entera: una OT mezclada reparte sus cargos entre actividades.
            return {
              codigo: c?.code, descripcion: c?.description, ordenes: f.eventos,
              horasDeParo: Math.round(f.minutosParo / 60),
              costo: Math.round(f.costo),
            };
          })
          .sort((a, b) => b.ordenes - a.ordenes),
        causasRaiz: porCausa
          .map((c) => ({ causa: causas.find((x) => x.id === c.rootCauseId)?.description, ordenes: c._count._all }))
          .sort((a, b) => b.ordenes - a.ordenes),
        ordenesCerradasSinCausaRaiz: sinCausa,
      };
    }

    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}
