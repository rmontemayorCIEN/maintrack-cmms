import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { escuchar, MAXIMO_SEGUNDOS_DICTADO, USD_POR_SEGUNDO } from "@/lib/escucha";
import { puedeUsarIa, registrarEscucha } from "@/lib/ia/consumo";
import { buscar } from "@/lib/busqueda";
import { OPEN_STATUSES, REQUEST_OPEN_STATUSES } from "@/lib/constants";
import { destinoDe, folioPedido, intencionDeOrden, quitarAnuncio, quitarVerbo, DESTINOS, ATAJOS, EJEMPLOS } from "@/lib/navegacion-voz";
import { adivinarDestino } from "@/lib/ia/navegar";
import { iaConfigurada } from "@/lib/ia/cliente";
import { puedeVerRuta } from "@/lib/pantallas";

/**
 * «Llévame a…»: decir a dónde y que el sistema lleve.
 *
 * ── Sin permiso especifico, y es deliberado ──
 *
 * `withAuth(null)` pide sesion y nada mas. Navegar no escribe: lleva a una
 * pantalla que la persona ya podia abrir por el menu. Exigir un permiso de
 * escritura dejaria fuera a quien solo consulta, que es de los que mas lo
 * agradecen —no se sabe el menu de memoria—.
 *
 * Lo que SI se cuida es que no se convierta en una puerta trasera: cada
 * destino pasa por `puedeVerRuta`, la misma tabla con la que se arma el menu,
 * y la busqueda ya filtra por rol por su cuenta. Si alguien pide a gritos una
 * pantalla que no le toca, se le dice que no existe para el, no se le lleva.
 *
 * ── Una sola vuelta, no dos ──
 *
 * Recibe el audio y devuelve el destino. Podria ser transcribir por un lado y
 * resolver por otro, pero eso son dos viajes desde un telefono en la planta, y
 * el segundo se siente. Aqui lo que tarda es oir; resolver es instantaneo
 * porque no pasa por el modelo.
 *
 * ── Tambien acepta texto, y no es solo para la prueba ──
 *
 * Con `Content-Type: application/json` se manda `{ texto }` y se resuelve
 * igual. Sirve para escribir «llevame a las vencidas» donde no se puede
 * hablar —una junta, una planta ruidosa— y hace que la funcion se pueda
 * probar de punta a punta sin depender de Google: los permisos, la busqueda y
 * los atajos se ejercitan de verdad, no se imitan.
 *
 * Por texto NO se descuenta bolsa ni se registra gasto, porque no lo hay:
 * resolver no cuesta. Lo que la bolsa raciona es oir.
 */

/** Un comando hablado no llega ni a diez segundos; cuatro megas sobran. */
const MAXIMO_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const org = {
      id: orgId,
      plan: user.organization.plan,
      iaComplemento: user.organization.iaComplemento,
      iaExtra: user.organization.iaExtra,
    };

    const escrito = request.headers.get("content-type")?.includes("application/json");

    let dicho = "";
    let segundos: number | null = null;

    if (escrito) {
      const cuerpo = await request.json().catch(() => ({}));
      dicho = String((cuerpo as { texto?: unknown }).texto ?? "").trim().slice(0, 200);
      if (!dicho) return fail("No llegó el texto", 422);
    } else {
      // Solo se revisa el cupo cuando hay que oir, que es lo unico que cuesta.
      const veredicto = await puedeUsarIa(org, "NAVEGAR");
      if (!veredicto.permitido) return fail(veredicto.motivo, 402);

      const crudo = await request.arrayBuffer();
      if (!crudo.byteLength) return fail("No llegó el audio", 422);
      if (crudo.byteLength > MAXIMO_BYTES) {
        return fail(`La grabación es muy larga. Máximo ${MAXIMO_SEGUNDOS_DICTADO} segundos.`, 413);
      }

      const oido = await escuchar(Buffer.from(crudo), "largo");
      if (!oido) return fail("No se pudo oír en este momento. Use el menú.", 502);
      segundos = oido.segundosFacturados;
      dicho = oido.texto.trim();
    }

    /**
     * Se registra pase lo que pase, porque Google ya cobro.
     *
     * `ok` significa «se resolvio a donde ir», no «se transcribio»: un comando
     * que no se pudo atender no se le descuenta al cliente, y de paso queda
     * guardado QUE fue lo que no se entendio.
     */
    const anotar = (resuelto: boolean) => {
      if (escrito) return; // no hubo nada que oir: no hay gasto que registrar
      void registrarEscucha({
        organizationId: orgId,
        userId: user.id,
        funcion: "NAVEGAR",
        segundos: segundos ?? 0,
        costoUsd: (segundos ?? 0) * USD_POR_SEGUNDO,
        ok: resuelto,
        noSeEntendio: resuelto ? null : dicho || "(no se entendió nada)",
      });
    };

    const sinRumbo = (mensaje: string) => {
      anotar(false);
      return ok({ texto: dicho, ruta: null, mensaje, ejemplos: EJEMPLOS });
    };

    if (!dicho) return sinRumbo("No le entendí. Acérquese el teléfono e intente de nuevo.");

    const contexto = {
      esSuperAdmin: user.isSuperAdmin,
      esDemo: Boolean((user.organization as { esDemo?: boolean }).esDemo),
    };
    const llevar = (ruta: string, titulo: string) => {
      // Ni el catalogo de pantallas ni los atajos saben quien esta hablando:
      // el filtro por rol se aplica aqui, con la misma tabla del menu.
      if (!puedeVerRuta(user.role, ruta, contexto)) {
        return sinRumbo(`«${titulo}» no está disponible para su perfil.`);
      }
      anotar(true);
      return ok({ texto: dicho, ruta, titulo });
    };

    // 1. Una pantalla o un atajo con filtro: es lo mas comun y no toca la base.
    const directo = destinoDe(dicho);
    if (directo) return llevar(directo.ruta, directo.titulo);

    // 2. «La orden mas antigua»: hay que mirar la base para saber cual es.
    const intencion = intencionDeOrden(dicho);
    if (intencion) {
      const antigua = intencion.clase === "masAntigua";
      if (intencion.que === "orden") {
        if (!puedeVerRuta(user.role, "/work-orders", contexto)) {
          return sinRumbo("Las órdenes de trabajo no están disponibles para su perfil.");
        }
        const wo = await prisma.workOrder.findFirst({
          // Solo las que siguen vivas: llevar a la orden mas antigua de la
          // historia —cerrada hace tres años— no le sirve a nadie. Lo que se
          // esta pidiendo es «lo que lleva mas tiempo esperando». El criterio
          // de «abierta» se toma de `constants.ts`, que es el que usa la lista.
          where: { organizationId: orgId, status: { in: OPEN_STATUSES } },
          orderBy: { createdAt: antigua ? "asc" : "desc" },
          select: { id: true, number: true },
        });
        if (!wo) return sinRumbo("No hay órdenes de trabajo abiertas.");
        return llevar(`/work-orders/${wo.id}`, `Orden ${wo.number}`);
      }
      if (!puedeVerRuta(user.role, "/requests", contexto)) {
        return sinRumbo("Las solicitudes no están disponibles para su perfil.");
      }
      const sol = await prisma.workRequest.findFirst({
        where: { organizationId: orgId, status: { in: REQUEST_OPEN_STATUSES } },
        orderBy: { createdAt: antigua ? "asc" : "desc" },
        select: { id: true, number: true },
      });
      if (!sol) return sinRumbo("No hay solicitudes pendientes.");
      return llevar(`/requests/${sol.id}`, `Solicitud ${sol.number}`);
    }

    /**
     * 3. Un folio dicho por su numero: «la orden de trabajo once».
     *
     * Se reconstruye el folio completo —OT-000011— y se busca ESE. Buscar
     * «11» a secas encontraba la 11, la 110, la 1100 y cualquier orden que
     * mencionara «11» en su titulo; con varias coincidencias no se podia
     * elegir y se terminaba abriendo la busqueda, que no es lo que se pidio.
     */
    const folio = folioPedido(dicho);
    if (folio) {
      const halladas = await buscar(
        { id: user.id, role: user.role, isSuperAdmin: user.isSuperAdmin, organizationId: orgId },
        folio,
      );
      // El folio no viaja como campo propio en el resultado, pero el título
      // empieza con él: «OT-000011 · Cambio de rodamiento».
      const exacto = halladas.flatMap((g) => g.resultados).filter((r) => r.titulo.startsWith(folio));
      if (exacto.length === 1) return llevar(exacto[0].enlace, exacto[0].titulo);
      // Si no existe, se dice con su folio: es mas util que «no encontre eso».
      if (!exacto.length) return sinRumbo(`No encontré ${folio}.`);
    }

    // 3. Un equipo, un folio, una refaccion: lo resuelve la busqueda general,
    //    que ya acota por empresa y por rol. No se reimplementa aqui.
    /**
     * Tambien se le quita el anuncio: «abre el equipo compresor de tornillo»
     * busca «compresor de tornillo». Ningun activo se llama «equipo compresor
     * de tornillo», asi que dejarlo puesto hacia que no se encontrara nada.
     */
    const termino = quitarAnuncio(quitarVerbo(dicho));
    if (termino.length >= 2) {
      const grupos = await buscar(
        { id: user.id, role: user.role, isSuperAdmin: user.isSuperAdmin, organizationId: orgId },
        termino,
      );
      const encontrados = grupos.flatMap((g) => g.resultados);
      if (encontrados.length === 1) {
        const r = encontrados[0];
        return llevar(r.enlace, r.titulo);
      }
      /**
       * Varios resultados: NO se elige por la persona.
       *
       * Con dos equipos que se llaman parecido, adivinar tiene la mitad de
       * probabilidades de llevarla al equivocado —y sin que lo note, porque la
       * pantalla se ve igual de bien—. Se abre la busqueda con lo que dijo y
       * ella escoge, que es una pantalla mas y ningun riesgo.
       */
      if (encontrados.length > 1) {
        return llevar(`/search?q=${encodeURIComponent(termino)}`, `Resultados de «${termino}»`);
      }
    }

    /**
     * 4. Ultimo recurso: preguntarle al modelo.
     *
     * Hasta aqui no se gasto nada mas que oir, y nueve de cada diez comandos
     * ya salieron. Este entra solo cuando la alternativa es decir «no encontre
     * eso», y por eso se puede permitir tardar un segundo mas.
     *
     * Se le pasan UNICAMENTE las pantallas que este rol ve, y lo que conteste
     * se vuelve a comprobar: elegir de una lista corta y verificar lo elegido
     * es lo que impide que una frase rara abra algo que no le toca.
     *
     * Consume un dictado mas de la bolsa —el de oir y el de pensar—, y es
     * justo: costo mas. Solo pasa cuando las reglas ya no pudieron.
     */
    if (iaConfigurada() && !escrito) {
      const puedeUsar = await puedeUsarIa(org, "NAVEGAR");
      if (puedeUsar.permitido) {
        const opciones = [
          ...DESTINOS.map((d) => ({ ruta: d.ruta, titulo: d.titulo })),
          ...ATAJOS.map((a) => ({ ruta: a.ruta, titulo: a.titulo })),
        ].filter((o) => puedeVerRuta(user.role, o.ruta, contexto));

        const sugerido = await adivinarDestino(org, { dicho, opciones, userId: user.id });
        if (sugerido) {
          const cual = opciones.find((o) => o.ruta === sugerido.ruta);
          return llevar(sugerido.ruta, cual?.titulo ?? sugerido.ruta);
        }
      }
    }

    return sinRumbo(`No encontré «${dicho}».`);
  });
}
