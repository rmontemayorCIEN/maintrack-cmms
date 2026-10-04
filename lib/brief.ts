/**
 * El brief del dia: lo que la direccion necesita saber, para escucharlo.
 *
 * ── Por que el guion se arma AQUI y no lo escribe el modelo ──
 *
 * En pantalla, quien ve «12 vencidas» puede abrir la lista y contar. Oyendolo
 * mientras maneja, no. Si el modelo redondea 8.4 a «casi diez», dice «subio»
 * cuando bajo, o suma dos cifras que no se suman, NADIE lo caza —y al rato ese
 * numero inventado se repite en una junta—. La regla de que los numeros los
 * calcula TypeScript deja de ser buena practica y pasa a ser la unica defensa
 * que queda.
 *
 * Por eso este archivo no llama a la IA. Devuelve puntos con su texto ya
 * armado y sus cifras exactas; `lib/ia/brief.ts` solo los hilvana para que se
 * oigan como una persona hablando, y ahi se comprueba que no haya aparecido
 * ninguna cifra que no estuviera aqui.
 *
 * ── Por que es corto a proposito ──
 *
 * El inicio de un director trae cuatro cifras, la franja de la planta y dos
 * bloques. Recitarlo son dos minutos de letania que nadie oye completos. El
 * brief dice lo UNICO que importa hoy y ofrece el detalle; lo demas se
 * consulta preguntando.
 */
import { prisma } from "./db";
import { franjaDePlanta } from "./planta";
import { filtroDeVencidas } from "./vencimiento";
import { OT_ACTIVAS, refaccionesCriticasAgotadas } from "./avisos/situaciones";
import { porAutorizar } from "./compras";
import { verCostos } from "./pantallas";
import { can } from "./rbac";
import { formatCurrency } from "./utils";
import { alertaAbierta } from "./alertas";

/** Cuantos puntos se dicen, como maximo. Arriba de esto ya nadie escucha. */
export const MAX_PUNTOS = 5;

export type PuntoDelBrief = {
  clave: string;
  /** Menor es mas urgente. Decide el orden y que se queda fuera. */
  peso: number;
  /** La frase, con sus cifras ya resueltas. Esto es lo que se dice. */
  texto: string;
  /** A donde ir si quiere verlo. */
  enlace?: string;
};

export type GuionDelDia = {
  saludo: string;
  /** «domingo 21 de septiembre» en la zona de la empresa. */
  fecha: string;
  puntos: PuntoDelBrief[];
  /** Puntos que no cupieron: se dicen en una linea al final. */
  masPuntos: number;
  /** Nada que reportar. Se dice, no se calla. */
  tranquilo: boolean;
  /** Todas las cifras que aparecen en los textos, para poder verificarlas. */
  cifras: string[];
};

type Usuario = {
  id: string; name: string; role: string; organizationId: string;
  organization: { timezone: string | null; currency: string };
};

const DIA = 86_400_000;

function saludoDe(ahora: Date, zona: string, nombre: string): string {
  const hora = Number(new Intl.DateTimeFormat("es-MX", { hour: "2-digit", hour12: false, timeZone: zona }).format(ahora));
  const momento = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  return `${momento}, ${nombre.split(" ")[0]}`;
}

function fechaDe(ahora: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: zona }).format(ahora);
}

/**
 * El dinero, como se dice en voz alta.
 *
 * «$128,400.00» leido por un sintetizador sale como «signo de pesos ciento
 * veintiocho coma cuatrocientos punto cero cero». Se escribe como lo diria una
 * persona, y los centavos se van: a nadie le importan al volante.
 */
function pesosHablados(monto: number, moneda: string): string {
  const n = Math.round(monto);
  if (n >= 1_000_000) {
    const millones = n / 1_000_000;
    return `${millones.toFixed(millones >= 10 ? 0 : 1).replace(".0", "")} millones de pesos`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)} mil pesos`;
  if (n >= 1000) {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    return resto ? `${miles} mil ${resto} pesos` : `${miles} mil pesos`;
  }
  return moneda === "MXN" ? `${n} pesos` : formatCurrency(n, moneda);
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/**
 * Un texto de la base, listo para decirse.
 *
 * Lo que se lee bien no se oye bien. Los titulos del sistema traen guiones
 * largos y a veces el nombre del equipo repetido —«Vibracion husillo — Centro
 * de maquinado VF-4», y luego el brief decia «en Centro de maquinado VF-4»—.
 * En pantalla eso no molesta; dicho en voz alta suena a maquina.
 */
function paraVoz(texto: string): string {
  return texto
    // Una coma, no dos puntos: los dos puntos en medio de una frase se oyen
    // como un corte raro, y la coma es la pausa que haria una persona.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "");
}

/** El mismo texto, sin repetir el nombre del equipo si ya lo trae. */
function sinRepetir(titulo: string, equipo: string | undefined): string {
  const limpio = paraVoz(titulo);
  if (!equipo) return limpio;
  return limpio.toLowerCase().includes(paraVoz(equipo).toLowerCase()) ? limpio : `${limpio}, en ${paraVoz(equipo)}`;
}

/**
 * El guion del dia para esta persona.
 *
 * Todo sale de consultas acotadas a su empresa. Si no ve costos por su rol,
 * ningun punto trae importes: el brief no es una puerta lateral a lo que la
 * pantalla le esconde.
 */
export async function guionDelDia(user: Usuario, ahora = new Date()): Promise<GuionDelDia> {
  const org = user.organizationId;
  const zona = user.organization.timezone || "America/Mexico_City";
  const moneda = user.organization.currency || "MXN";
  const conCostos = verCostos(user.role);

  const [detenidos, vencidas, alertas, compras, agotadas, hoy, franja] = await Promise.all([
    // Equipos caidos AHORA, los criticos primero: es lo unico que puede
    // significar produccion parada en este momento.
    prisma.asset.findMany({
      where: { organizationId: org, status: "DOWN", active: true },
      select: { code: true, name: true, criticality: true, location: { select: { name: true } } },
      orderBy: [{ criticality: "asc" }, { code: "asc" }],
      take: 10,
    }),
    prisma.workOrder.findMany({
      where: { organizationId: org, ...filtroDeVencidas(zona, ahora) },
      select: { number: true, title: true, dueDate: true, priority: true, asset: { select: { code: true, name: true } } },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
    prisma.predictiveAlert.findMany({
      where: { organizationId: org, ...alertaAbierta() },
      select: { severity: true, title: true, createdAt: true, asset: { select: { code: true, name: true } } },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
      take: 20,
    }),
    // Solo a quien puede firmar. Decirle a un tecnico que «hay una compra
    // esperando su autorizacion» es mandarlo a una pantalla donde no puede
    // hacer nada: el permiso de autorizar es de direccion.
    //
    // El MISMO criterio que usa el inicio para «Revisar autorizaciones»,
    // incluido el «no lo que usted mismo pidio».
    can(user.role, "purchase:authorize")
      ? prisma.purchaseRequest.findMany({
          where: porAutorizar(org, user.id),
          select: { folio: true, montoEstimado: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 20,
        })
      : Promise.resolve([] as Array<{ folio: string; montoEstimado: number; createdAt: Date }>),
    refaccionesCriticasAgotadas(org).catch(() => [] as Array<{ code: string; name: string }>),
    prisma.workOrder.count({
      where: {
        organizationId: org, status: { in: OT_ACTIVAS },
        dueDate: { gte: new Date(ahora.getTime() - DIA), lte: new Date(ahora.getTime() + DIA) },
      },
    }),
    franjaDePlanta(org, ahora, zona).catch(() => null),
  ]);

  const puntos: PuntoDelBrief[] = [];

  // 1. Lo que esta parado ahora mismo.
  if (detenidos.length) {
    const criticos = detenidos.filter((a) => a.criticality === "A");
    const primero = criticos[0] ?? detenidos[0];
    const donde = primero.location?.name ? ` en ${primero.location.name}` : "";
    puntos.push({
      clave: "detenidos",
      peso: 0,
      texto: detenidos.length === 1
        ? `Trae abajo ${paraVoz(primero.name)}${donde}.${primero.criticality === "A" ? " Ese es criticidad A." : ""}`
        : `Trae ${detenidos.length} equipos abajo${criticos.length ? `, y ${criticos.length} ${plural(criticos.length, "es", "son")} criticidad A` : ""}. El más pesado es ${paraVoz(primero.name)}${donde}.`,
      enlace: "/assets?status=DOWN",
    });
  }

  // 2. Vencidas: cuantas, donde se juntan y cuanto lleva la mas vieja.
  if (vencidas.length) {
    const masVieja = vencidas[0];
    const dias = masVieja.dueDate ? Math.floor((ahora.getTime() - masVieja.dueDate.getTime()) / DIA) : 0;
    const peor = franja?.filas.find((f) => f.vencidas > 0);
    /**
     * Donde se juntan, y solo si de verdad se juntan. «Tiene 2 vencidas, 2 de
     * ellas estan en la Nave» no informa nada y al oido suena a error.
     */
    const concentracion = peor && peor.vencidas > 1 && peor.vencidas < vencidas.length
      ? ` ${peor.vencidas} se le están amontonando en ${peor.nombre}.`
      : "";
    puntos.push({
      clave: "vencidas",
      peso: 1,
      texto: `${vencidas.length === 1 ? "Tiene una orden vencida" : `Se le juntaron ${vencidas.length} órdenes vencidas`}.${concentracion}${dias > 0 ? ` La más vieja ya lleva ${dias} ${plural(dias, "día", "días")}: ${sinRepetir(masVieja.title, masVieja.asset?.name)}.` : ""}`,
      enlace: "/work-orders?vencidas=1",
    });
  }

  // 3. Alertas predictivas: el aviso que llega ANTES de la falla, y que por eso
  //    mismo es el que mas se deja pasar.
  if (alertas.length) {
    const criticas = alertas.filter((a) => a.severity === "CRITICAL");
    const primera = criticas[0] ?? alertas[0];
    const dias = Math.floor((ahora.getTime() - primera.createdAt.getTime()) / DIA);
    puntos.push({
      clave: "alertas",
      peso: criticas.length ? 2 : 4,
      texto: `${alertas.length === 1 ? "Queda una alerta sin que nadie la vea" : `Quedan ${alertas.length} alertas sin que nadie las vea`}${criticas.length ? `, y ${criticas.length} ${plural(criticas.length, "es crítica", "son críticas")}` : ""}. La que más lleva esperando es ${sinRepetir(primera.title, primera.asset?.name)}${dias > 0 ? `, desde hace ${dias} ${plural(dias, "día", "días")}` : ""}.`,
      enlace: "/alerts",
    });
  }

  // 4. Lo que espera SU firma. Va alto aunque sean pocas: es lo unico del
  //    brief que nadie mas puede destrabar.
  if (compras.length) {
    const total = compras.reduce((s, c) => s + (c.montoEstimado ?? 0), 0);
    const vieja = Math.floor((ahora.getTime() - compras[0].createdAt.getTime()) / DIA);
    puntos.push({
      clave: "compras",
      peso: 3,
      texto: `${compras.length === 1 ? "Y hay una compra esperando su firma" : `Y hay ${compras.length} compras esperando su firma`}${conCostos && total > 0 ? `, por ${pesosHablados(total, moneda)}` : ""}.${vieja > 0 ? ` La primera lleva ${vieja} ${plural(vieja, "día", "días")} parada ahí.` : ""}`,
      enlace: "/compras",
    });
  }

  // 5. Refacciones criticas en cero: trabajo que no puede empezar.
  if (agotadas.length) {
    puntos.push({
      clave: "agotadas",
      peso: 5,
      texto: `${agotadas.length === 1 ? "Se quedó sin una refacción crítica" : `Se quedó sin ${agotadas.length} refacciones críticas`}: ${agotadas.slice(0, 2).map((p) => paraVoz(p.name)).join(" y ")}${agotadas.length > 2 ? ", entre otras" : ""}.`,
      enlace: "/inventory",
    });
  }

  // 6. El dia. Solo si no hay nada peor que contar: al que trae equipos
  //    parados no le importa cuantas ordenes vencen hoy.
  if (hoy > 0 && puntos.length < 2) {
    puntos.push({
      clave: "hoy",
      peso: 6,
      texto: `Para hoy ${plural(hoy, "trae una orden programada", `trae ${hoy} órdenes programadas`)}.`,
      enlace: "/calendar",
    });
  }

  puntos.sort((a, b) => a.peso - b.peso);
  const dichos = puntos.slice(0, MAX_PUNTOS);
  const masPuntos = Math.max(puntos.length - MAX_PUNTOS, 0);

  return {
    saludo: saludoDe(ahora, zona, user.name),
    fecha: fechaDe(ahora, zona),
    puntos: dichos,
    masPuntos,
    tranquilo: puntos.length === 0,
    /**
     * TODO lo que se le entrega al modelo, no solo los puntos.
     *
     * La fecha es parte del guion y el modelo la dice —«hoy es lunes 21»—, asi
     * que ese 21 es legitimo. La primera version solo miraba los puntos y por
     * eso descartaba CADA redaccion que mencionara la fecha: el brief se
     * habria caido al guion plano siempre, y sin avisar. Lo encontro la prueba
     * que llama al modelo de verdad.
     */
    cifras: cifrasDe([
      ...dichos,
      { clave: "fecha", peso: 99, texto: `${saludoDe(ahora, zona, user.name)} ${fechaDe(ahora, zona)}` },
      { clave: "mas", peso: 99, texto: String(masPuntos) },
    ]),
  };
}

/**
 * Los numeros que aparecen en el guion.
 *
 * Sirven para comprobar despues que la redaccion no invento ninguno. Se
 * guardan tal cual se escribieron, porque es asi como hay que encontrarlos en
 * el texto redactado.
 */
export function cifrasDe(puntos: PuntoDelBrief[]): string[] {
  const encontradas = new Set<string>();
  for (const p of puntos) {
    for (const n of p.texto.match(/\d[\d,.]*/g) ?? []) encontradas.add(n.replace(/[.,]$/, ""));
  }
  return [...encontradas];
}
