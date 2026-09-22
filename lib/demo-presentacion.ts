import {
  BENEFICIOS_POR_ROL, COBRO, DESCRIPCION, DIFERENCIADORES, FLUJO_OPERATIVO, IMPLEMENTACION_HONESTA,
  LEMA, MARCA, MODULOS, NO_ES, PROBLEMAS, RUTA_IMPLEMENTACION, SEGURIDAD, SOPORTE, SUBLEMA, TEXTO_PRUEBA, precio,
} from "./comercial";
import { COMPLEMENTO_IA, ORDEN_PLANES, PLANES } from "./planes";
import { FUNCIONES_IA, type ClaveFuncionIA } from "./ia/funciones";
import { HISTORIAS, ORDEN_RECOMENDADO } from "./demo-guia";

/**
 * La presentación al cliente, en diapositivas.
 *
 * No es otro discurso: cada dato sale de `lib/comercial.ts` (lo que MainTrack
 * dice de sí mismo), de `lib/planes.ts` (precios y límites) y de
 * `lib/demo-guia.ts` (las cinco historias). Escribir aquí un precio o una
 * promesa a mano es garantizar que un día la diapositiva diga una cosa y el
 * sitio otra, delante del cliente.
 *
 * Lo que sí vive aquí es el ORDEN y el remate: qué se cuenta primero, qué se
 * enseña en el sistema y con qué se cierra.
 */

export type Liga = { etiqueta: string; href: string };

export type Bloque =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "puntos"; items: string[] }
  | { tipo: "tarjetas"; items: Array<{ titulo: string; texto: string; pie?: string }>; columnas?: 2 | 3 }
  /** Numerados. El título es opcional: los pasos de una historia ya empiezan con el verbo. */
  | { tipo: "pasos"; items: Array<{ titulo: string; texto: string }> }
  | { tipo: "cambio"; items: Array<{ antes: string; detalle: string; despues: string; capacidades: string[] }> }
  | { tipo: "destacado"; titulo: string; texto: string }
  | { tipo: "planes"; items: Array<{ nombre: string; precio: string; descripcion: string; incluye: string[]; nota?: string }> }
  | { tipo: "filas"; items: Array<{ etiqueta: string; texto: string }> };

export type Diapositiva = {
  clave: string;
  /** Agrupa el índice: el cliente ve en qué parte de la junta va. */
  seccion: string;
  titulo: string;
  entradilla?: string;
  bloques: Bloque[];
  /** Portada y cierre se dibujan centradas y en grande. */
  presentacion?: "portada" | "cierre";
  /** Con qué cuenta conviene estar dentro del sistema. */
  rol?: string;
  minutos?: number;
  /** Para quien presenta; no se proyecta grande. */
  nota?: string;
  ligas?: Liga[];
};

/** Las funciones de IA que se enseñan: las que ya operan y se ven en la demo. */
const IA_EN_LA_DEMO: ClaveFuncionIA[] = ["BRIEF", "DIAGNOSTICO", "CIERRE_OT", "PLAN", "TRIAGE", "AYUDA"];

const miles = (n: number) => (n === Infinity ? "sin límite" : n.toLocaleString("es-MX"));

/**
 * Arma la presentación. Las ligas de cada historia se resuelven contra la
 * empresa demostrativa (`app/(app)/demo/presentacion`), porque un identificador
 * de activo o de solicitud cambia cada vez que se restaura la demo.
 */
export function armarPresentacion(ligasPorHistoria: Record<string, Liga[]> = {}): Diapositiva[] {
  const historias = ORDEN_RECOMENDADO.map((k) => HISTORIAS.find((h) => h.clave === k)!);

  return [
    {
      clave: "portada", seccion: "Apertura", presentacion: "portada",
      titulo: LEMA,
      entradilla: SUBLEMA,
      bloques: [{ tipo: "parrafo", texto: `Todo lo que va a ver es ${MARCA} funcionando, con una planta de ejemplo y su historia de los últimos 90 días.` }],
      nota: "Diga cuánto va a durar (20 a 30 minutos) y que al final hay tiempo para preguntas.",
    },
    {
      clave: "problema", seccion: "Por qué",
      titulo: "Lo que cuesta atender el mantenimiento tarde",
      entradilla: "Cinco problemas que aparecen en casi toda planta. Si reconoce tres, hay dinero sobre la mesa.",
      bloques: [{ tipo: "cambio", items: PROBLEMAS.map((p) => ({ antes: p.problema, detalle: p.detalle, despues: p.respuesta, capacidades: p.capacidades })) }],
      nota: "Pregunte cuál de los cinco pesa más en su planta y amarre el resto de la demostración a ese.",
    },
    {
      clave: "que-es", seccion: "Por qué",
      titulo: `Qué es ${MARCA}`,
      entradilla: DESCRIPCION,
      bloques: [{ tipo: "tarjetas", columnas: 3, items: MODULOS.map((m) => ({ titulo: m.nombre, texto: m.texto })) }],
    },
    {
      clave: "no-es", seccion: "Por qué",
      titulo: "Y qué no es",
      entradilla: "Decirlo temprano evita la decepción cara: esto no sustituye su ERP ni su contabilidad.",
      bloques: [{ tipo: "puntos", items: NO_ES }],
      nota: "Esta diapositiva vende. El cliente que ya vivió una promesa incumplida agradece que se marque el límite.",
    },
    {
      clave: "flujo", seccion: "El sistema",
      titulo: "Una falla, de principio a fin",
      entradilla: "El mismo camino que vamos a recorrer en el sistema, en el orden en que pasa en la planta.",
      bloques: [{ tipo: "pasos", items: FLUJO_OPERATIVO.map((f) => ({ titulo: f.paso, texto: f.texto })) }],
    },
    {
      clave: "roles", seccion: "El sistema",
      titulo: "Cada quien ve lo suyo",
      entradilla: "Nadie tiene que aprender el sistema completo: cada rol entra a su pantalla, con sus acciones.",
      bloques: [{ tipo: "filas", items: BENEFICIOS_POR_ROL.map((b) => ({ etiqueta: b.rol, texto: b.beneficio })) }],
    },
    {
      clave: "diferencia", seccion: "El sistema",
      titulo: "Lo que lo hace distinto",
      entradilla: "Lo que no viene en cualquier sistema de órdenes de trabajo.",
      bloques: [{ tipo: "tarjetas", columnas: 3, items: DIFERENCIADORES.map((d) => ({ titulo: d.titulo, texto: d.texto })) }],
    },
    {
      clave: "casos", seccion: "Casos",
      titulo: "Ahora, en el sistema real",
      entradilla: "Cinco historias completas sobre la empresa demostrativa. Cada una tiene botones para abrir la pantalla de la que se está hablando.",
      bloques: [{
        tipo: "pasos",
        items: historias.map((h) => ({ titulo: `${h.titulo} · ${h.minutos} min`, texto: h.inicio })),
      }],
      nota: "Si el tiempo se acorta, escoja dos: «Lo que ve la dirección» y la que toque el problema que el cliente reconoció.",
    },
    ...historias.map((h, i): Diapositiva => ({
      clave: `caso-${h.clave}`, seccion: "Casos",
      titulo: h.titulo,
      entradilla: h.inicio,
      rol: h.rol, minutos: h.minutos,
      bloques: [
        { tipo: "destacado", titulo: "El problema", texto: h.problema },
        { tipo: "pasos", items: h.pasos.map((p) => ({ titulo: "", texto: p })) },
        { tipo: "destacado", titulo: "Lo que se explica al final", texto: h.resultado },
      ],
      ligas: ligasPorHistoria[h.clave] ?? [],
      nota: `Historia ${i + 1} de ${historias.length}. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.`,
    })),
    {
      clave: "ia", seccion: "Cómo se trabaja",
      titulo: "Dónde entra la inteligencia artificial",
      entradilla: "Interpreta y redacta sobre sus propios datos. No inventa números ni decide por usted.",
      bloques: [
        { tipo: "tarjetas", columnas: 3, items: IA_EN_LA_DEMO.map((c) => ({ titulo: FUNCIONES_IA[c].nombre, texto: FUNCIONES_IA[c].descripcion })) },
        { tipo: "destacado", titulo: "La aritmética no es de la IA", texto: "Disponibilidad, cumplimiento, costos, MTBF y MTTR los calcula el sistema con lo registrado, y cada indicador muestra su fórmula. La IA lee esos números ya calculados para explicar y proponer; nunca los suma ella." },
        { tipo: "parrafo", texto: `Se cobra en operaciones al mes, no en tokens: ${PLANES.PROFESSIONAL.nombre} incluye ${PLANES.PROFESSIONAL.ia.operaciones} y ${PLANES.ENTERPRISE.nombre} ${PLANES.ENTERPRISE.ia.operaciones}. El complemento «${COMPLEMENTO_IA.nombre}» agrega ${COMPLEMENTO_IA.operaciones} más y todas las funciones, por ${precio(COMPLEMENTO_IA.precioMensual)} al mes. Dos cosas tienen su propia bolsa y no gastan las operaciones del plan: preguntar cómo se usa el sistema, y el parte del día. Son de uso diario, y racionarlas seria empujar a no usarlas.` },
      ],
      ligas: [{ etiqueta: "Diagnóstico con IA", href: "/diagnostico" }, { etiqueta: "Consulta en lenguaje natural", href: "/consulta" }],
    },
    {
      clave: "voz", seccion: "Cómo se trabaja",
      titulo: "El sistema habla, y también escucha",
      entradilla: "Lo que un director alcanza a revisar mientras maneja a la planta.",
      bloques: [
        {
          tipo: "tarjetas", columnas: 2, items: [
            {
              titulo: "El parte del día",
              texto: "En el inicio hay un botón que lo cuenta en voz alta: qué está parado, qué se venció, qué alerta hay y qué compra espera su firma. Con pausas, como lo diría el jefe de mantenimiento por teléfono.",
              pie: "En los dos planes.",
            },
            {
              titulo: "Prefiero preguntar y escuchar",
              texto: "En «Pregunte a sus datos» se toca el micrófono y se pregunta hablando —«¿cuántas órdenes tengo vencidas?»—. El sistema consulta, contesta en voz alta y deja la respuesta escrita para copiarla.",
              pie: "Enterprise, para quien ve el panorama, con tope mensual por empresa.",
            },
          ],
        },
        {
          tipo: "destacado", titulo: "Las cifras no las dice la IA",
          texto: "Los totales, los conteos y las tendencias los calcula el sistema y se le entregan ya resueltos; la IA solo los hilvana para que suenen como los diría una persona. Antes de hablar se verifica que no haya agregado ninguna cifra que no estuviera.",
        },
        {
          tipo: "parrafo",
          texto: "Cada quien elige la voz que prefiere en Ajustes, y se puede probar antes de guardarla. Lo hablado pasa por los mismos permisos que lo escrito: nadie oye lo que no podría ver en pantalla.",
        },
      ],
      ligas: [{ etiqueta: "El parte del día", href: "/dashboard" }, { etiqueta: "Preguntar hablando", href: "/consulta" }],
      nota: "Si hay bocina, reprodúzcalo. Es lo que más se recuerda de la demo, y no se explica: se oye.",
    },
    {
      clave: "seguridad", seccion: "Cómo se trabaja",
      titulo: "Su información, separada y respaldada",
      bloques: [
        { tipo: "puntos", items: SEGURIDAD },
        { tipo: "filas", items: [
          { etiqueta: "Soporte", texto: `${SOPORTE.canal}. ${SOPORTE.horario}` },
          { etiqueta: "Tiempos", texto: "Se comprometen tiempos de respuesta y de actualización por severidad, no tiempos de solución: dependen de la causa." },
          { etiqueta: "Disponibilidad", texto: SOPORTE.disponibilidad },
        ] },
      ],
      nota: "Aquí suele salir la pregunta de dónde viven los datos. La respuesta está en la diapositiva; no la adorne.",
    },
    {
      clave: "implementacion", seccion: "Cómo se trabaja",
      titulo: "Cómo se arranca",
      entradilla: IMPLEMENTACION_HONESTA,
      bloques: [
        { tipo: "pasos", items: RUTA_IMPLEMENTACION.map((e) => ({ titulo: e.etapa, texto: `${e.texto} — ${e.quien}.` })) },
      ],
      ligas: [{ etiqueta: "Puesta en marcha", href: "/puesta-en-marcha" }],
    },
    {
      clave: "precios", seccion: "Cierre",
      titulo: "Planes y precios",
      entradilla: `${TEXTO_PRUEBA}, sin tarjeta y sin cargos.`,
      bloques: [
        {
          tipo: "planes",
          items: ORDEN_PLANES.map((p) => ({
            nombre: PLANES[p].nombre,
            precio: `${precio(PLANES[p].precioMensual)} al mes`,
            descripcion: PLANES[p].descripcion,
            incluye: PLANES[p].incluye,
            nota: PLANES[p].limites.assets === Infinity ? "Activos, usuarios y sitios sin límite." : `Hasta ${miles(PLANES[p].limites.assets)} activos y ${miles(PLANES[p].limites.users)} usuarios.`,
          })),
        },
        { tipo: "filas", items: [
          { etiqueta: "Complemento de IA", texto: `${COMPLEMENTO_IA.nombre}: ${COMPLEMENTO_IA.descripcion} Por ${precio(COMPLEMENTO_IA.precioMensual)} al mes, sobre cualquier plan.` },
          { etiqueta: "Cómo se cobra", texto: `${COBRO.periodicidad}, en ${COBRO.moneda}. ${COBRO.manual}` },
          { etiqueta: "Impuestos", texto: COBRO.impuestos },
          { etiqueta: "Si no sigue", texto: COBRO.cancelacion },
        ] },
      ],
      nota: "No negocie el precio en la junta. Si lo piden, ofrezca empezar la prueba hoy y revisar el plan cuando se vea el volumen real.",
    },
    {
      clave: "gracias", seccion: "Cierre", presentacion: "cierre",
      titulo: "Gracias",
      entradilla: `Lo que sigue, si quiere verlo con sus equipos: le dejamos su cuenta con ${TEXTO_PRUEBA.toLowerCase()} y arrancamos con su lista de equipos.`,
      bloques: [
        { tipo: "pasos", items: [
          { titulo: "Esta semana", texto: "Nos manda su catálogo de equipos como lo tenga: hoja de cálculo, lista o fotos de placa." },
          { titulo: "La siguiente", texto: "Le entregamos la cuenta cargada y capacitamos por rol, una sesión cada uno." },
          { titulo: "El primer mes", texto: "Opera de verdad, acompañado: revisamos juntos la calidad de los datos cada semana." },
        ] },
        { tipo: "parrafo", texto: "¿Qué parte quiere ver otra vez?" },
      ],
      nota: "Cierre pidiendo algo concreto y chico: la lista de equipos. Es el compromiso más fácil de cumplir y el que arranca todo.",
    },
  ];
}
