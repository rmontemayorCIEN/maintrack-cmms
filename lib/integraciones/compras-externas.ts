/**
 * El ciclo de compra visto desde el ERP del cliente.
 *
 * Es la pieza que cierra la integración de verdad: mantenimiento pide, el ERP
 * compra, y lo que llega entra al almacén de MainTrack con su kardex y su
 * costo. Sin esto la integración era de una sola mano —el ERP podía enterarse
 * de que había una compra por autorizar y nada más—.
 *
 * ── Nada de lógica nueva ──
 *
 * `colocarOrdenExterna` llama `enCompra()` y `recibirExterno` llama
 * `recibir()`: las MISMAS funciones que usa la pantalla. Por eso el ERP no
 * puede hacer algo que una persona no podría —recibir de más, recibir contra
 * una compra cancelada, entrar material sin kardex— y por eso un arreglo en la
 * regla de negocio arregla las dos puertas a la vez. Copiar aquí la validación
 * era garantizar que un día la pantalla y la API se comportaran distinto.
 *
 * ── Cómo se nombran las cosas ──
 *
 * El ERP no conoce los identificadores internos de MainTrack, así que todo se
 * pide por el código que el cliente ya usa: folio de la compra, código del
 * almacén, código de la refacción, RFC o nombre del proveedor. Es el mismo
 * criterio de `entrada.ts`, y es lo que hace que la integración no dependa de
 * guardar tablas de equivalencia en los dos lados.
 *
 * ── Los montos ──
 *
 * El costo estimado y el monto de la requisición solo salen si la credencial
 * tiene además `costos:leer`. Es una casilla más que el cliente marca: una
 * integración que solo confirma folios de orden de compra no tiene por qué ver
 * los precios de nadie.
 */
import { z } from "zod";
import { prisma } from "../db";
import { ESTADOS_COMPRA, type EstadoCompra } from "../estados-compra";
import { ErrorDeCompra, enCompra, recibir } from "../compras";
import { ErrorApi, pagina, paginacion, type RespuestaApi } from "./api";
import type { Identidad } from "./credenciales";

function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) {
    throw new ErrorApi(422, "DATOS_INVALIDOS", "Revise los campos marcados.",
      r.error.issues.map((i) => ({ campo: i.path.join("."), problema: i.message })));
  }
  return r.data;
}

/**
 * Una regla de compras incumplida es del cliente, no del sistema: su texto ya
 * está redactado para que una persona lo entienda —«de este renglón faltan 3 y
 * se intentan entrar 5»— y se devuelve tal cual, con 422.
 */
function comoErrorApi(e: unknown): never {
  if (e instanceof ErrorDeCompra) throw new ErrorApi(422, "REGLA_DE_COMPRAS", e.message);
  throw e;
}

/** La compra por folio, dentro de la empresa de la credencial. */
async function compraPorFolio(orgId: string, folio: string) {
  const c = await prisma.purchaseRequest.findFirst({
    where: { organizationId: orgId, folio },
    select: { id: true, folio: true, estado: true, warehouseId: true },
  });
  if (!c) throw new ErrorApi(404, "COMPRA_NO_ENCONTRADA", `No existe la requisición de compra «${folio}».`);
  return c;
}

// ─────────────────────────────────────────────── Consultar

const ESTADOS_POR_COLOCAR: EstadoCompra[] = ["AUTORIZADA"];

/**
 * GET /api/v1/compras — lo que mantenimiento necesita comprar.
 *
 * Por omisión devuelve solo las AUTORIZADAS, que son las que el ERP tiene que
 * colocar: es la pregunta que un ERP hace cada mañana, y contestar con las
 * canceladas y las ya recibidas obligaba al cliente a filtrar de su lado.
 */
export async function listarComprasExternas(quien: Identidad, url: URL): Promise<RespuestaApi> {
  const p = paginacion(url);
  const pedido = url.searchParams.get("estado")?.trim().toUpperCase();
  if (pedido && !(pedido in ESTADOS_COMPRA)) {
    throw new ErrorApi(422, "ESTADO_INVALIDO", `Estado «${pedido}» desconocido. Use uno de: ${Object.keys(ESTADOS_COMPRA).join(", ")}.`);
  }
  const costos = quien.alcances.includes("costos:leer");
  const filas = await prisma.purchaseRequest.findMany({
    where: { organizationId: quien.organizationId, estado: pedido ? pedido : { in: ESTADOS_POR_COLOCAR } },
    orderBy: { id: "asc" }, take: p.take, ...(p.cursor ? { cursor: p.cursor, skip: p.skip } : {}),
    select: {
      id: true, folio: true, estado: true, urgencia: true, justificacion: true, ordenCompra: true,
      montoEstimado: true, autorizadaEl: true, createdAt: true,
      warehouse: { select: { code: true, name: true } },
      proveedorSugerido: { select: { name: true, rfc: true } },
      materialRequest: { select: { folio: true, workOrder: { select: { number: true, asset: { select: { code: true } } } } } },
      renglones: {
        select: {
          descripcion: true, cantidadSolicitada: true, cantidadRecibida: true, costoEstimado: true, nota: true,
          part: { select: { code: true, unit: true } },
        },
      },
    },
  });
  const { datos, siguienteCursor } = pagina(filas, p.limite);
  return {
    estado: 200,
    cuerpo: {
      datos: datos.map((c) => ({
        folio: c.folio,
        estado: c.estado,
        urgencia: c.urgencia,
        justificacion: c.justificacion,
        almacen: c.warehouse.code,
        almacenNombre: c.warehouse.name,
        proveedorSugerido: c.proveedorSugerido ? { nombre: c.proveedorSugerido.name, rfc: c.proveedorSugerido.rfc } : null,
        ordenCompra: c.ordenCompra,
        // Para qué es la compra: sin esto el comprador no sabe si urge.
        requisicion: c.materialRequest?.folio ?? null,
        orden: c.materialRequest?.workOrder?.number ?? null,
        activo: c.materialRequest?.workOrder?.asset?.code ?? null,
        autorizada: c.autorizadaEl?.toISOString() ?? null,
        creada: c.createdAt.toISOString(),
        ...(costos ? { montoEstimado: c.montoEstimado } : {}),
        renglones: c.renglones.map((r) => ({
          refaccion: r.part?.code ?? null,
          descripcion: r.descripcion,
          unidad: r.part?.unit ?? null,
          cantidadSolicitada: r.cantidadSolicitada,
          cantidadRecibida: r.cantidadRecibida,
          porRecibir: Math.max(0, r.cantidadSolicitada - r.cantidadRecibida),
          nota: r.nota,
          ...(costos ? { costoEstimado: r.costoEstimado } : {}),
        })),
      })),
      siguienteCursor,
    },
  };
}

// ─────────────────────────────────────────────── Colocar la orden de compra

export const esquemaOrdenDeCompra = z.object({
  compra: z.string().trim().min(1).max(60).describe("Folio de la requisición de compra en MainTrack"),
  ordenCompra: z.string().trim().min(1).max(60).describe("Folio de la orden de compra en su ERP"),
});

/**
 * POST /api/v1/ordenes-compra — «ya la compré, aquí está mi folio».
 *
 * Con esto el que pidió la refacción deja de preguntar en qué va: la compra
 * pasa a «En compra» con el folio del ERP a la vista, y los avisos que
 * esperaban ese paso se atienden solos.
 */
export async function colocarOrdenExterna(quien: Identidad, cuerpo: unknown): Promise<RespuestaApi> {
  const d = validar(esquemaOrdenDeCompra, cuerpo);
  const compra = await compraPorFolio(quien.organizationId, d.compra);
  // Repetir la misma orden de compra sobre una compra ya colocada no es un
  // error del ERP: es un reintento. Se contesta lo mismo, sin tocar nada.
  if (compra.estado === "EN_COMPRA") {
    const ya = await prisma.purchaseRequest.findUnique({ where: { id: compra.id }, select: { ordenCompra: true } });
    if (ya?.ordenCompra === d.ordenCompra.trim()) {
      return { estado: 200, cuerpo: { compra: compra.folio, estado: compra.estado, ordenCompra: ya.ordenCompra, repetida: true } };
    }
  }
  try {
    const r = await enCompra({ organizationId: quien.organizationId, requestId: compra.id, ordenCompra: d.ordenCompra });
    return { estado: 200, cuerpo: { compra: r.folio, estado: r.estado, ordenCompra: d.ordenCompra.trim() } };
  } catch (e) {
    comoErrorApi(e);
  }
}

// ─────────────────────────────────────────────── Recibir mercancía

export const esquemaRecepcion = z.object({
  compra: z.string().trim().max(60).optional().describe("Folio de la requisición de compra; opcional si la entrada no viene de una"),
  almacen: z.string().trim().min(1).max(60).describe("Código del almacén donde entra"),
  proveedor: z.string().trim().max(200).optional().describe("RFC o nombre exacto del proveedor"),
  remision: z.string().trim().max(60).optional(),
  ordenCompra: z.string().trim().max(60).optional(),
  nota: z.string().trim().max(500).optional(),
  renglones: z.array(z.object({
    refaccion: z.string().trim().min(1).max(60).describe("Código de la refacción en MainTrack"),
    cantidad: z.number().finite().positive(),
    costoUnitario: z.number().finite().nonnegative(),
    conforme: z.boolean().optional().describe("Falso si NO pasó la revisión física; se recibe igual pero queda señalado. Si se omite, conforme"),
    observacion: z.string().trim().max(300).optional(),
  })).min(1),
});

/**
 * POST /api/v1/recepciones — llegó la mercancía.
 *
 * Pasa por `recibir()`, así que el material entra al kardex con su costo, el
 * costo promedio ponderado se recalcula, los renglones de la compra se marcan,
 * los avisos de «bajo mínimo» que la entrada resolvió se cierran, y a quien
 * pidió la refacción le llega que ya llegó. Nada de eso se escribe aquí.
 *
 * La `Idempotency-Key` se le pasa como clave de la recepción: la capa de la API
 * guarda la respuesta cuando ya terminó, y dos envíos a la vez la rebasarían.
 * La clave, con su índice único, es la que de verdad impide que el material
 * entre dos veces al inventario.
 */
export async function recibirExterno(quien: Identidad, cuerpo: unknown, clave: string | null): Promise<RespuestaApi> {
  const d = validar(esquemaRecepcion, cuerpo);
  const org = quien.organizationId;

  const almacen = await prisma.warehouse.findFirst({
    where: { organizationId: org, code: d.almacen, active: true },
    select: { id: true },
  });
  if (!almacen) throw new ErrorApi(404, "ALMACEN_NO_ENCONTRADO", `No existe el almacén «${d.almacen}» o está inactivo.`);

  const compra = d.compra ? await compraPorFolio(org, d.compra) : null;

  let supplierId: string | null = null;
  if (d.proveedor) {
    const prov = await prisma.supplier.findFirst({
      where: { organizationId: org, OR: [{ rfc: d.proveedor }, { name: d.proveedor }] },
      select: { id: true },
    });
    if (!prov) throw new ErrorApi(404, "PROVEEDOR_NO_ENCONTRADO", `No existe el proveedor «${d.proveedor}». Mande su RFC o su nombre tal como está registrado.`);
    supplierId = prov.id;
  }

  // Las refacciones, por código y en un solo golpe.
  const codigos = [...new Set(d.renglones.map((r) => r.refaccion))];
  const partes = await prisma.part.findMany({
    where: { organizationId: org, code: { in: codigos } },
    select: { id: true, code: true },
  });
  const porCodigo = new Map(partes.map((x) => [x.code, x.id]));
  const faltantes = codigos.filter((c) => !porCodigo.has(c));
  if (faltantes.length) {
    throw new ErrorApi(404, "REFACCION_NO_ENCONTRADA",
      `No existen en el catálogo: ${faltantes.join(", ")}. Dé de alta la refacción antes de recibirla, o cárguela con una importación.`);
  }

  /**
   * Contra qué renglón de la compra va cada cosa.
   *
   * Sin esto la recepción entraría al inventario pero la compra seguiría
   * diciendo que falta todo por recibir, y nunca pasaría a «Recibida». Se
   * empareja por refacción, y contra el primer renglón al que todavía le falte
   * —que es lo que hace una persona en pantalla cuando la compra trae dos
   * renglones de lo mismo—.
   */
  const pendientes = compra
    ? await prisma.purchaseRequestLine.findMany({
        where: { requestId: compra.id },
        select: { id: true, partId: true, cantidadSolicitada: true, cantidadRecibida: true },
      })
    : [];
  const consumido = new Map<string, number>();
  const renglones = d.renglones.map((r) => {
    const partId = porCodigo.get(r.refaccion)!;
    const linea = pendientes.find((l) => {
      if (l.partId !== partId) return false;
      const falta = l.cantidadSolicitada - l.cantidadRecibida - (consumido.get(l.id) ?? 0);
      return falta > 0.0001;
    });
    if (linea) consumido.set(linea.id, (consumido.get(linea.id) ?? 0) + r.cantidad);
    return {
      requestLineId: linea?.id ?? null,
      partId,
      cantidad: r.cantidad,
      costoUnitario: r.costoUnitario,
      conforme: r.conforme ?? true,
      observacion: r.observacion ?? null,
    };
  });

  try {
    const rec = await recibir({
      organizationId: org,
      // No hay persona detrás: la recepción queda a nombre de la integración.
      userId: null,
      integracion: `Integración: ${quien.nombre}`.slice(0, 120),
      purchaseRequestId: compra?.id ?? null,
      warehouseId: almacen.id,
      supplierId,
      remision: d.remision ?? null,
      ordenCompra: d.ordenCompra ?? null,
      nota: d.nota ?? null,
      clave,
      renglones,
    });
    return { estado: 201, cuerpo: { recepcion: rec.folio, compra: compra?.folio ?? null, renglones: renglones.length } };
  } catch (e) {
    comoErrorApi(e);
  }
}
