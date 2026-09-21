/**
 * Vocabulario de mantenimiento.
 *
 *   t  termino tal como se escribe
 *   n  nombre completo, si el termino es una sigla
 *   c  categoria, para agrupar en la pantalla del glosario
 *   d  definicion en lenguaje llano
 *   noAuto  el termino aparece en el glosario pero NO se subraya solo dentro
 *           de los textos. Se usa en palabras de uso corriente ("activo",
 *           "paro", "refaccion"): marcarlas en cada frase seria ruido.
 */
export type TerminoGlosario = {
  t: string;
  n?: string;
  c: string;
  d: string;
  noAuto?: boolean;
};

export const CATEGORIAS_GLOSARIO = [
  "Todas",
  "Indicadores",
  "Tipos de mantenimiento",
  "Activos",
  "Operacion",
  "Programacion",
  "Predictivo",
  "Almacen",
  "Costos",
] as const;

export const GLOSARIO: TerminoGlosario[] = [
  // ─────────────────────────────────────────────────────────── Indicadores
  { t: "MTTR", n: "Tiempo medio de reparación", c: "Indicadores", d: "Cuanto se tarda en promedio en reparar un equipo, desde que el trabajo arranca hasta que vuelve a operar. Mide la eficacia del equipo de mantenimiento, no la calidad del activo. Si sube, el problema esta en la organizacion del trabajo: refacciones que no estaban, personal sin disponibilidad, diagnostico lento." },
  { t: "MTBF", n: "Tiempo medio entre fallas", c: "Indicadores", d: "Cuantas horas opera un equipo, en promedio, entre una falla y la siguiente. Mide la confiabilidad del activo. Subirlo es el objetivo real del mantenimiento preventivo y predictivo." },
  { t: "MTTF", n: "Tiempo medio hasta la falla", c: "Indicadores", d: "Como el MTBF, pero para componentes que no se reparan sino que se reemplazan: un rodamiento, un filtro, un foco." },
  { t: "Disponibilidad", c: "Indicadores", d: "Porcentaje del tiempo que el equipo estuvo listo para producir. Se calcula quitando el tiempo de paro al tiempo calendario. Una planta bien llevada ronda 95% o mas; abajo de 90% hay un problema de fondo." },
  { t: "Confiabilidad", c: "Indicadores", d: "Probabilidad de que un equipo funcione sin fallar durante un periodo dado. Un equipo puede tener alta disponibilidad y baja confiabilidad si falla seguido pero se repara rápido." },
  { t: "Cumplimiento PM", n: "Cumplimiento del programa preventivo", c: "Indicadores", d: "Porcentaje de ordenes preventivas cerradas dentro de su fecha compromiso. Es el indicador que delata si el preventivo se esta ejecutando de verdad o solo existe en el papel. Meta habitual: 90% o mas." },
  { t: "Trabajo planificado", c: "Indicadores", d: "Proporción del trabajo que se hizo con programa, contra el que se hizo apagando fuegos. En plantas de clase mundial ronda 80%. Debajo de 50%, mantenimiento vive en reacción permanente." },
  { t: "Backlog", n: "Trabajo pendiente", c: "Indicadores", d: "Ordenes abiertas que aun no se ejecutan, medidas en horas de trabajo. Un backlog sano equivale a entre dos y cuatro semanas de carga: menos indica personal ocioso, mas indica que el trabajo se acumula mas rapido de lo que se despacha." },
  { t: "Wrench time", n: "Tiempo llave en mano", c: "Indicadores", d: "Horas que el técnico realmente pasa con las manos en el equipo, sin contar traslados, esperas ni busqueda de refacciones. En la mayoria de las plantas ronda 35%, y ahi esta la mayor oportunidad de mejora." },
  { t: "OEE", n: "Eficiencia general de los equipos", c: "Indicadores", d: "Multiplica disponibilidad por rendimiento por calidad. Es el indicador que conecta el mantenimiento con la produccion: un equipo disponible que produce lento o con defectos no esta aportando." },
  { t: "Tiempo de respuesta", c: "Indicadores", d: "Lo que transcurre entre que se reporta una falla y que alguien empieza a atenderla. En equipos críticos es tan importante como el MTTR." },
  { t: "Adherencia al programa", c: "Indicadores", d: "Que tanto se ejecuto lo que estaba programado para la semana, sin sustituirlo por trabajos improvisados." },

  // ──────────────────────────────────────────── Tipos de mantenimiento
  { t: "Mantenimiento preventivo", n: "PM", c: "Tipos de mantenimiento", d: "Trabajo programado por tiempo o por uso, antes de que el equipo falle: lubricar cada 30 dias, cambiar aceite cada 500 horas. Es la base del programa, pero por si solo no evita todas las fallas." },
  { t: "Mantenimiento correctivo", c: "Tipos de mantenimiento", d: "Reparar algo que ya fallo. Siempre existira, pero cuando domina el programa el costo se dispara: la falla decide cuando ocurre, con que refacciones y a que hora." },
  { t: "Mantenimiento predictivo", n: "PdM", c: "Tipos de mantenimiento", d: "Medir el estado real del equipo —vibración, temperatura, aceite— para intervenir justo antes de la falla. Evita cambiar piezas que aun servian y sorpresas que paran la línea." },
  { t: "Mantenimiento basado en condición", n: "CBM", c: "Tipos de mantenimiento", d: "Se actua según lo que dice la medición, no según el calendario. Es el principio detras del mantenimiento predictivo." },
  { t: "Mantenimiento proactivo", c: "Tipos de mantenimiento", d: "Ataca la causa de fondo en vez del sintoma: si un rodamiento falla cada seis meses, corregir la desalineacion que lo destruye." },
  { t: "RCM", n: "Mantenimiento centrado en la confiabilidad", c: "Tipos de mantenimiento", d: "Metodologia que decide que mantenimiento aplicar a cada equipo según las consecuencias de su falla, en vez de darle el mismo trato a todo." },
  { t: "TPM", n: "Mantenimiento productivo total", c: "Tipos de mantenimiento", d: "Enfoque donde el operador participa del cuidado basico del equipo —limpieza, inspección, lubricación— y mantenimiento se concentra en lo especializado." },
  { t: "Mantenimiento mejorativo", c: "Tipos de mantenimiento", d: "Modificar el equipo para que falle menos, en lugar de repararlo igual cada vez. Cambiar un material, agregar un guarda, rediseñar un soporte." },
  { t: "Inspeccion", c: "Tipos de mantenimiento", noAuto: true, d: "Revision programada sin desarmar: verificar niveles, ruidos, fugas, temperatura al tacto. Barata y de alto rendimiento cuando se hace con ruta y registro." },

  // ────────────────────────────────────────────────────────────── Activos
  { t: "Activo", c: "Activos", noAuto: true, d: "Cualquier equipo, instalacion o componente sujeto a mantenimiento. En el sistema cada activo tiene su TAG, su historial de trabajos y su costo acumulado." },
  { t: "TAG", n: "Código de identificación del activo", c: "Activos", d: "Codigo unico e inmutable del equipo, por ejemplo BOM-101. Es la llave con la que se amarra todo su historial; por eso el sistema no permite cambiarlo despues de creado." },
  { t: "Criticidad", c: "Activos", d: "Que tanto duele que ese equipo se detenga. Se clasifica A, B o C según impacto en producción, seguridad y costo. Determina la prioridad de las órdenes y el nivel de monitoreo que justifica." },
  { t: "Análisis ABC", c: "Activos", d: "Ordenar los activos en tres grupos por importancia. Los A son pocos y concentran el riesgo: ahi va el preventivo fino y el monitoreo de condicion. Los C reciben lo minimo." },
  { t: "Jerarquia de activos", c: "Activos", d: "Estructura de padre e hijos: planta, area, linea, equipo, componente. Permite ver el costo de una linea completa y no solo de una pieza suelta." },
  { t: "Vida útil", c: "Activos", d: "Periodo durante el cual se espera que el equipo opere de forma economica. Superarla no obliga a reemplazar, pero si a vigilar el costo acumulado de mantenerlo." },
  { t: "Valor de reposición", c: "Activos", d: "Lo que costaria comprar hoy un equipo equivalente. Sirve de referencia: cuando el costo acumulado de mantener se acerca a ese valor, conviene evaluar el reemplazo." },
  { t: "Salud del equipo", c: "Activos", d: "Indice de 0 a 100 que resume el estado de los puntos de monitoreo de un activo. Cae conforme los sensores se acercan a sus umbrales." },

  { t: "Sistema", c: "Activos", noAuto: true, d: "Un grupo de equipos que sirve o no sirve como un todo —la linea de produccion, el cuarto de compresores, los elevadores— y del que alguien responde. Puede cruzar areas, y es la forma en que la direccion mira la planta: no importa que bomba fallo, importa si la linea esta parada." },
  { t: "Garantia", c: "Activos", noAuto: true, d: "El periodo en que una falla la cubre el fabricante. El sistema la vigila porque reparar por cuenta propia un equipo en garantia es pagar dos veces, y es un error que solo se descubre cuando ya se hizo." },

  // ──────────────────────────────────────────────────────────── Operacion
  { t: "Orden de trabajo", n: "OT", c: "Operacion", d: "El documento que autoriza, describe y registra un trabajo de mantenimiento. Concentra quien lo hizo, cuanto tardo, que refacciones consumio y cuanto costo. Sin OT no hay historial, y sin historial no hay indicadores." },
  { t: "Solicitud de servicio", c: "Operacion", d: "Reporte de falla que levanta produccion u operaciones. No es todavia un trabajo autorizado: un supervisor la revisa y decide si se convierte en orden de trabajo." },
  { t: "Paro", c: "Operacion", noAuto: true, d: "Tiempo en que el equipo no puede producir. Es el costo real de una falla, casi siempre mayor que la reparación misma." },
  { t: "Paro programado", c: "Operacion", d: "Detención planeada con anticipación para hacer mantenimiento. Cuesta, pero se decide cuando ocurre y con todo listo." },
  { t: "Paro no programado", c: "Operacion", d: "Detencion por falla imprevista. Es el que verdaderamente duele: interrumpe produccion, obliga a improvisar y suele arrastrar horas extra." },
  { t: "LOTO", n: "Bloqueo y etiquetado", c: "Operacion", d: "Procedimiento de seguridad para aislar la energia de un equipo antes de intervenirlo: bloquear el interruptor, etiquetarlo y verificar energia cero. No es tramite: es lo que evita que alguien arranque la maquina con un tecnico dentro." },
  { t: "Causa raiz", c: "Operacion", d: "El motivo de fondo de una falla, no el sintoma. Si un rodamiento se quema, la causa raiz no es el rodamiento: es la falta de lubricacion, la desalineacion o el sobrecarga que lo destruyo." },
  { t: "RCA", n: "Análisis de causa raiz", c: "Operacion", d: "Metodo estructurado para llegar al origen de una falla en vez de quedarse en el síntoma. La tecnica mas simple es preguntar por que cinco veces seguidas." },
  { t: "Código de falla", c: "Operacion", d: "Clasificación estandarizada de la causa al cerrar una orden correctiva. Capturarlo bien es lo que permite después detectar fallas repetidas y atacar el patrón." },
  { t: "Modo de falla", c: "Operacion", d: "La forma especifica en que un componente deja de cumplir su funcion: fractura, desgaste, obstruccion, corto circuito." },
  { t: "Falla funcional", c: "Operacion", d: "Cuando el equipo deja de hacer lo que se espera de el, aunque siga encendido. Una bomba que gira pero no da presión ya fallo funcionalmente." },
  { t: "Lista de verificación", c: "Operacion", d: "Las tareas que el tecnico debe completar dentro de una orden. Las obligatorias impiden cerrarla si quedan pendientes: es lo que evita el cierre a la ligera." },
  { t: "Bitacora", c: "Operacion", noAuto: true, d: "Notas cronologicas del equipo de trabajo dentro de una orden. Sirve para dejar constancia de hallazgos que no caben en un campo estructurado." },

  { t: "Escalamiento", c: "Operacion", d: "Que un aviso suba de nivel cuando nadie lo atiende en el tiempo previsto. Existe porque el aviso que no se ve es igual al aviso que no se mando: si el tecnico no responde, se le avisa a supervision." },

  // ───────────────────────────────────────────────────────── Programacion
  { t: "Plan de mantenimiento", c: "Programacion", d: "La regla que genera ordenes preventivas de forma automatica: que activo, con que frecuencia, que tareas y quien lo hace. Es la pieza que convierte las buenas intenciones en trabajo programado." },
  { t: "Disparo por calendario", c: "Programacion", d: "El plan se activa cada cierto numero de dias, sin importar cuanto se uso el equipo. Apropiado para lo que se degrada con el tiempo: sellos, aceites, corrosion." },
  { t: "Disparo por medidor", c: "Programacion", d: "El plan se activa al alcanzar cierta lectura: 500 horas, 10 000 kilometros, 50 000 ciclos. Apropiado para lo que se desgasta con el uso." },
  { t: "Anticipacion", n: "Lead time", c: "Programacion", d: "Con cuantos días de adelanto se genera la orden antes de su fecha de vencimiento, para dar margen de conseguir refacciones y programar personal." },
  { t: "Tolerancia", c: "Programacion", d: "Margen de días que se acepta alrededor de la fecha compromiso sin considerar incumplido el preventivo." },
  { t: "Horometro", c: "Programacion", d: "Contador de horas de operación de un equipo. Base de los planes por uso real y no por calendario." },
  { t: "Medidor", c: "Programacion", noAuto: true, d: "Cualquier contador asociado a un activo: horas, kilometros, ciclos, piezas producidas. El sistema calcula el consumo promedio diario para proyectar cuando vencera el proximo plan." },
  { t: "Ruta de inspección", c: "Programacion", d: "Recorrido programado donde un técnico revisa varios equipos en secuencia, tomando lecturas. Es la forma economica de hacer monitoreo de condición sin sensores permanentes." },

  // ────────────────────────────────────────────────────────────── Predictivo
  { t: "Monitoreo de condición", c: "Predictivo", d: "Medir periodicamente variables que revelan el estado interno del equipo sin desarmarlo: vibracion, temperatura, corriente, particulas en el aceite." },
  { t: "Vibracion", c: "Predictivo", noAuto: true, d: "La variable predictiva mas usada en equipo rotativo. Su patrón delata desbalanceo, desalineación, holgura o daño en rodamientos mucho antes de que se oiga o se sienta." },
  { t: "Termografia", c: "Predictivo", d: "Cámara infrarroja que detecta puntos calientes. En tableros electricos revela conexiones flojas antes de que provoquen un incendio o un paro." },
  { t: "Análisis de aceite", c: "Predictivo", d: "Examen del lubricante usado. Las particulas metalicas que trae indican que componente se esta desgastando y a que ritmo." },
  { t: "Ultrasonido", c: "Predictivo", noAuto: true, d: "Detecta sonidos por encima del oido humano. Sirve para hallar fugas de aire comprimido y descargas electricas." },
  { t: "Umbral de alerta", c: "Predictivo", d: "Valor a partir del cual la medición deja de ser normal y conviene programar una intervención. Todavía hay tiempo para planear." },
  { t: "Umbral crítico", c: "Predictivo", d: "Valor a partir del cual el riesgo de falla es inminente. En este sistema, cruzarlo genera automáticamente una orden predictiva." },
  { t: "RUL", n: "Vida útil remanente", c: "Predictivo", d: "Estimación de cuanto le queda al componente antes de fallar, proyectando la tendencia de las mediciones. Es lo que permite decidir si se aguanta hasta el próximo paro programado." },
  { t: "Curva P-F", n: "Curva potencial-funcional", c: "Predictivo", d: "El intervalo entre el momento en que la falla empieza a ser detectable (P) y el momento en que ocurre (F). Cuanto mas temprano se detecta, mas margen hay para planear en vez de reaccionar." },
  { t: "Tendencia", c: "Predictivo", noAuto: true, d: "La direccion y velocidad con que cambia una medicion. Importa mas que el valor aislado: una vibracion de 4 mm/s estable preocupa menos que una de 3 subiendo rapido." },

  { t: "Umbral", c: "Predictivo", d: "El valor a partir del cual una lectura deja de ser normal. Se define por equipo y por variable: la vibracion que es rutina en un molino es una alarma en una bomba. Un umbral mal puesto genera alertas que nadie cree, y esas se dejan de ver." },

  // ───────────────────────────────────────────────────────────────── Almacen
  { t: "Refaccion", c: "Almacen", noAuto: true, d: "Pieza de repuesto que se consume en los trabajos de mantenimiento. Su disponibilidad determina el MTTR tanto como la habilidad del técnico." },
  { t: "Punto de reorden", c: "Almacen", d: "Nivel de existencia que dispara la reposición. Debe cubrir el consumo esperado durante el tiempo que tarda el proveedor en surtir." },
  { t: "Stock mínimo", c: "Almacen", d: "La cantidad por debajo de la cual no debe caer una refacción. En equipos críticos se calcula por riesgo de paro, no por consumo promedio." },
  { t: "Kardex", c: "Almacen", d: "El historial de entradas y salidas de una refaccion, renglon por renglon, con quien la movio y a que orden se cargo. Es la unica forma de explicar por que hay lo que hay: si el kardex y la existencia no coinciden, el problema es de captura, no de inventario." },
  { t: "Requisicion de material", n: "RM", c: "Almacen", d: "Lo que un tecnico pide del almacen para hacer un trabajo. Si la refaccion esta, sale del almacen; si no, se convierte en la semilla de una compra. Sirve para que el faltante quede registrado en vez de resolverse de boca en boca." },
  { t: "Requisicion de compra", n: "RC", c: "Almacen", d: "La peticion de comprar algo que no hay. Pasa por autorizacion antes de volverse orden de compra: es donde la direccion decide si el gasto procede, y donde queda constancia de cuanto tardo en decidirse." },
  { t: "Orden de compra", n: "OC", c: "Almacen", d: "El compromiso formal con el proveedor: que se pidio, a que precio y para cuando. A partir de aqui el faltante ya tiene fecha, y el sistema puede avisar cuando esa fecha se vence sin que llegue nada." },
  { t: "Recepcion", c: "Almacen", d: "La llegada de lo comprado. Es el momento en que la refaccion entra al kardex y actualiza el costo promedio; recibir menos de lo pedido deja la compra abierta, que es como se detectan los surtidos incompletos." },
  { t: "Conteo ciclico", c: "Almacen", d: "Contar una parte del almacen cada cierto tiempo, en vez de parar todo una vez al año. Lo que se encuentra distinto se ajusta con su motivo, y ese ajuste queda en el kardex: un inventario que cuadra sin explicar los ajustes no cuadra." },
  { t: "Traspaso", n: "TR", c: "Almacen", d: "Mover existencia de un almacen a otro sin que sea consumo. Importa porque una refaccion que esta en la bodega equivocada, para efectos de un paro, es lo mismo que no tenerla." },
  { t: "Stock de seguridad", c: "Almacen", d: "El colchon que se guarda por encima del consumo esperado, para cubrir lo que no se puede predecir: un proveedor que se atrasa o una falla que consume mas de lo normal. En equipos criticos se dimensiona por el costo del paro, no por el de la pieza." },
  { t: "Proveedor", c: "Almacen", noAuto: true, d: "Quien surte refacciones o servicios. Su tiempo de entrega real —no el prometido— es lo que determina el punto de reorden de todo lo que le compra." },

  { t: "Stock máximo", c: "Almacen", d: "Techo de inventario. Existe porque cada pieza guardada es dinero detenido que además se deteriora." },
  { t: "Rotación de inventario", c: "Almacen", d: "Cuantas veces al año se consume y repone el almacén. Una rotación muy baja indica capital dormido en piezas que quiza nunca se usen." },
  { t: "Costo promedio ponderado", c: "Almacen", d: "Metodo de valuación que recalcula el costo unitario en cada entrada, mezclando lo que ya había con lo que llega. Es el que usa este sistema." },

  // ──────────────────────────────────────────────────────────────── Costos
  { t: "Costo de paro", c: "Costos", d: "Lo que deja de producirse mientras el equipo esta detenido. Casi siempre supera por mucho el costo de la reparación, y es el argumento real para invertir en preventivo." },
  { t: "Mano de obra", c: "Costos", noAuto: true, d: "Horas de personal cargadas a una orden, valuadas a la tarifa de cada técnico. Junto con refacciones forma el costo directo del trabajo." },
  { t: "Costo total de propiedad", n: "TCO", c: "Costos", d: "Todo lo que cuesta un equipo a lo largo de su vida: compra, operacion, mantenimiento y disposicion final. El precio de compra suele ser la parte menor." },
];

/* ── Deteccion de terminos dentro de los textos ─────────────────────────
   Indice ordenado de mayor a menor longitud: asi "mantenimiento preventivo"
   gana sobre cualquier fragmento suyo. */
type EntradaIndice = { clave: string; termino: TerminoGlosario; sigla: boolean };

export const INDICE_GLOSARIO: EntradaIndice[] = (() => {
  const entradas: EntradaIndice[] = [];
  for (const t of GLOSARIO) {
    if (t.noAuto) continue;
    entradas.push({ clave: t.t, termino: t, sigla: /^[A-Z0-9/\- ]+$/.test(t.t) });
    if (t.n && t.n.length > 6) entradas.push({ clave: t.n, termino: t, sigla: false });
  }
  return entradas.sort((a, b) => b.clave.length - a.clave.length);
})();

const escaparRegex = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Una sola expresion con todos los terminos, con limites de palabra para no
 *  marcar fragmentos dentro de otras palabras. */
export function crearRegexGlosario() {
  return new RegExp(
    "(?<![\\p{L}\\p{N}])(" +
      INDICE_GLOSARIO.map((e) => escaparRegex(e.clave)).join("|") +
      ")(?![\\p{L}\\p{N}])",
    "giu",
  );
}

/** Las siglas solo cuentan escritas en mayusculas: evita marcar "loto" o "tag"
 *  cuando aparecen como palabra corriente. */
export function buscarTermino(texto: string): TerminoGlosario | null {
  const limpio = texto.trim();
  const exacta = INDICE_GLOSARIO.find((e) => e.clave === limpio);
  if (exacta) return exacta.termino;
  const flexible = INDICE_GLOSARIO.find(
    (e) => !e.sigla && e.clave.toLowerCase() === limpio.toLowerCase(),
  );
  return flexible ? flexible.termino : null;
}
