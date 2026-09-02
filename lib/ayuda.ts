/**
 * Ayuda por pantalla.
 *
 * Cuatro bloques por pantalla, y el orden importa:
 *
 *   que      — una linea: que es esto
 *   hacer    — lo que se puede hacer aqui
 *   flujo    — de donde viene lo que ve y a donde va lo que hace. Este es el
 *              bloque que evita perderse: casi nadie se pierde por no entender
 *              una pantalla, sino por no ver como se conecta con las demas.
 *   noPuedo  — por que el sistema le puede decir que no. Nadie escribe esta
 *              seccion y es la que el usuario necesita, porque perderse casi
 *              siempre es "me dijo que no y no se por que".
 *
 * Este mismo catalogo alimenta la ayuda con IA. Un solo lugar donde vive la
 * verdad sobre como opera el sistema; si se escribe dos veces, una de las dos
 * va a quedar mintiendo.
 */

export type FichaAyuda = {
  titulo: string;
  que: string;
  hacer: string[];
  flujo: string[];
  /**
   * Que significa cada campo o columna. La explicacion dice la CONSECUENCIA,
   * no repite la etiqueta: "vencimiento: cuando debio estar hecha" no ayuda a
   * nadie; "en rojo cuando ya paso, y el numero son los dias que lleva
   * vencida" si.
   */
  campos?: Array<{ nombre: string; explica: string }>;
  /** Que hace cada boton propio de esta pantalla. */
  botones?: Array<{ nombre: string; explica: string }>;
  /**
   * Si la pantalla usa la tabla configurable. Sus controles se explican una
   * sola vez, en CONTROLES_TABLA, en vez de repetirse en ocho fichas que
   * despues se desincronizan.
   */
  tablaConfigurable?: boolean;
  noPuedo?: Array<{ sintoma: string; porque: string }>;
  /** Preguntas que el usuario suele hacer aqui. Se contestan sin llamar al modelo. */
  preguntas?: Array<{ pregunta: string; respuesta: string }>;
};

/** Los controles que comparten todas las listas configurables. */
export const CONTROLES_TABLA: Array<{ nombre: string; explica: string }> = [
  { nombre: "Filtrar", explica: "Busca en TODAS las columnas, incluidas las que tiene ocultas. Esconder una columna es decision de presentacion, no de que se puede encontrar." },
  { nombre: "Agrupar por…", explica: "Junta los renglones por el criterio que elija. Cada grupo trae su conteo y se pliega con un clic." },
  { nombre: "+ nivel 2 y + nivel 3", explica: "Agrupa dentro de lo agrupado, hasta tres niveles. Por ejemplo Sitio › Categoria › Criticidad." },
  { nombre: "Contraer todo / Expandir todo", explica: "Cierra o abre todos los grupos de golpe. Contraer cierra todos los niveles, para bajar de nivel en nivel al volver a abrir." },
  { nombre: "Columnas", explica: "Prende, apaga y acomoda columnas con las flechas. Las dos primeras son fijas: sin ellas la tabla deja de identificar de que habla." },
  { nombre: "Guardar vista", explica: "Deja su arreglo permanente. Es SUYO, no de la empresa: el almacenista y el jefe de mantenimiento no miran lo mismo." },
  { nombre: "De fabrica", explica: "Regresa a las columnas originales y quita la agrupacion." },
];

export const AYUDA: Record<string, FichaAyuda> = {
  "/requests/puntos": {
    titulo: "Puntos de reporte QR",
    que: "Códigos QR para pegar en máquinas y áreas. Quien los escanea reporta una falla sin cuenta ni contraseña.",
    hacer: [
      "Crear un punto para un lugar sin equipo registrado: un salón, un baño, un pasillo",
      "Imprimir la hoja con todos los códigos, lista para recortar y pegar",
      "Ver de cuál punto salen más reportes",
    ],
    flujo: [
      "Cada activo genera su propio código solo, la primera vez que se abre su ficha. Aquí no hay que darlo de alta.",
      "Quien escanea no elige sitio ni equipo: el código ya los trae, y por eso no necesita saber cómo se llama la máquina.",
      "El reporte cae en Solicitudes con estado pendiente y avisa por la campanita a propietarios, administradores y supervisores.",
      "Una solicitud nunca se vuelve orden sola: alguien de mantenimiento la revisa primero.",
    ],
    campos: [
      { nombre: "Nombre del punto", explica: "Como lo va a reconocer quien lo pega y quien lo escanea. Entre más específico, menos tiene que explicar el que reporta." },
      { nombre: "Sitio, área y equipo", explica: "Lo que el código va a heredarle a cada reporte. Un QR pegado en la máquina misma es el que más ahorra." },
      { nombre: "Reportes", explica: "Cuántas solicitudes han entrado por ese código. Un punto con muchos reportes es un área que necesita atención de fondo." },
    ],
    botones: [
      { nombre: "Nuevo punto", explica: "Crea el punto y genera su código de inmediato." },
      { nombre: "Imprimir todos", explica: "Hoja con los códigos activos, cada uno con su instrucción, lista para recortar." },
    ],
    noPuedo: [
      { sintoma: "Un código dejó de funcionar", porque: "Se desactivó. Desactivar sirve para revocar uno que se filtró sin invalidar los demás." },
    ],
    preguntas: [
      { pregunta: "¿Tengo que crear un código por cada equipo?", respuesta: "No. Cada activo ya tiene el suyo: ábralo en su ficha y ahí está, listo para imprimir. Aquí solo se crean los de lugares que no son un equipo." },
      { pregunta: "¿Quien reporta necesita cuenta?", respuesta: "No. Ese es el punto: un inquilino o un empleado no va a crear una cuenta por una llave que gotea. Solo deja su nombre y su celular para poder llamarle." },
      { pregunta: "¿Cómo le da seguimiento el que reportó?", respuesta: "Al enviar recibe un folio y una liga, y su teléfono queda reconocido: desde ahí entra a «Mis reportes» y ve todos los suyos sin teclear nada. Si usa otro dispositivo, se identifica una vez con su folio y su celular." },
      { pregunta: "¿Qué pasa si cambio de dominio?", respuesta: "Los códigos nuevos salen con la dirección nueva. Los ya impresos siguen funcionando mientras la dirección vieja responda." },
    ],
  },

  "/assets/levantamiento": {
    titulo: "Levantamiento de inventario asistido",
    que: "Levantar el inventario de equipos a partir de una descripción de la instalación y fotos de las áreas.",
    hacer: [
      "Describir la instalación y contestar unas preguntas",
      "Subir fotos de las áreas para que se reconozcan los equipos",
      "Revisar lo propuesto y dar de alta solo lo que aplique",
    ],
    flujo: [
      "Lo propuesto NO se da de alta solo: se revisa y se acepta renglón por renglón.",
      "Los activos nacen con la placa vacía a propósito, para que el recorrido en piso sepa qué verificar.",
      "Las fotos quedan como evidencia del levantamiento, con lo que se reconoció en cada una.",
    ],
    preguntas: [
      { pregunta: "¿Puedo subir fotos además de describir?", respuesta: "Sí, y conviene: lo que la cámara ve gana sobre lo que alguien recordó. Si una foto no sirve, le dice por qué y cómo repetirla." },
    ],
  },

  "/inventory/traspasos": {
    titulo: "Traspasos entre almacenes",
    que: "Mover existencia de un almacén a otro, con su documento.",
    hacer: ["Registrar un traspaso con uno o varios renglones"],
    flujo: [
      "Cada traspaso deja dos movimientos: la salida del origen y la entrada al destino. O cuadran los dos, o no ocurre ninguno.",
      "Solo se ofrecen refacciones que sí existen en el almacén de origen.",
    ],
    noPuedo: [
      { sintoma: "No aparece ninguna refacción", porque: "Ese almacén no tiene existencia de nada. Elija otro origen." },
    ],
  },

  "/inventory/indicadores": {
    titulo: "Indicadores de almacén",
    que: "Cómo se está comportando el almacén: si le sirve al técnico, si el dinero rota y si las cifras corresponden al anaquel.",
    hacer: ["Cambiar la ventana entre 30, 90, 180 y 365 días"],
    flujo: ["Todo se calcula de los movimientos, las requisiciones, las compras y los conteos. Nada se captura."],
    preguntas: [
      { pregunta: "¿Cuál es el indicador más importante?", respuesta: "El nivel de servicio. Debajo del 80% el técnico deja de confiar en el almacén y empieza a guardarse sus propias refacciones, que es cuando el inventario se vuelve ficción." },
    ],
  },

  "/inventory/analisis": {
    titulo: "Análisis de almacén",
    que: "Qué comprar, qué sobra y qué está a punto de detener un trabajo. Es la pantalla de decisiones, no de consulta.",
    hacer: ["Revisar cada lista y actuar sobre lo que aparece"],
    flujo: [
      "Cruza la existencia con lo que piden sus planes, con la criticidad del equipo que la consume y con el tiempo de entrega del proveedor.",
      "El mínimo útil es el que alcanza para una intervención completa más el tiempo de entrega, no un número redondo.",
    ],
  },

  "/work-orders/new": {
    titulo: "Nueva orden de trabajo",
    que: "Dar de alta una orden correctiva a mano.",
    hacer: ["Capturar el trabajo, el equipo, la prioridad y a quién se asigna"],
    flujo: [
      "Las preventivas no se capturan aquí: las genera el programador desde los planes.",
      "Sin activo, el costo de esta orden después no se le puede atribuir a ningún equipo.",
    ],
  },

  "/import": {
    titulo: "Importar datos",
    que: "Cargar activos, refacciones, planes y catálogos desde una hoja de cálculo.",
    hacer: ["Bajar la plantilla, llenarla y subirla", "Revisar los errores por renglón antes de confirmar"],
    flujo: [
      "Se valida todo antes de escribir: si un renglón falla, le dice cuál y por qué, y no se carga nada a medias.",
      "Hay orden: los activos necesitan sus sitios, y los planes necesitan sus activos.",
    ],
  },

  "/search": {
    titulo: "Búsqueda",
    que: "Encontrar una orden, un activo o una refacción por código o por nombre.",
    hacer: ["Escribir parte del código o del nombre"],
    flujo: ["Busca en toda la cuenta. Para preguntas en lenguaje natural, use Pregunte a sus datos."],
  },

  "/clients": {
    titulo: "Empresas cliente",
    que: "Las cuentas que opera desde esta plataforma. Solo para el operador.",
    hacer: ["Dar de alta una empresa", "Entrar a su cuenta para dar soporte o hacer la implementación", "Ver su avance de puesta en marcha"],
    flujo: [
      "Al entrar a una cuenta se ve un aviso permanente arriba, y todo lo que haga queda en la bitácora de esa empresa.",
      "El acceso se revalida en cada petición: si se retira el privilegio, la sesión deja de servir de inmediato.",
    ],
  },

  "/dashboard": {
    titulo: "Panel de control",
    que: "El estado de la operación de un vistazo: qué está detenido, qué vence hoy y en qué se está yendo el dinero.",
    hacer: [
      "Ver los indicadores del periodo y los equipos con más incidencias",
      "Entrar directo a lo que necesita atención desde cada tarjeta",
    ],
    flujo: [
      "Los números salen de las órdenes de trabajo cerradas y del kardex del almacén; no se capturan en ningún lado.",
      "Si un número se ve raro, ábralo: cada tarjeta lleva a la lista que lo produjo.",
    ],
  },

  "/backlog": {
    titulo: "Trabajo pendiente",
    que: "Las actividades que se liberaron de una orden porque no se pudieron hacer, y siguen esperando.",
    hacer: [
      "Ver qué quedó pendiente en cada equipo y por qué",
      "Saber cuáles ya se pueden hacer porque la refacción que faltaba ya llegó",
      "Ver cuánto lleva esperando cada actividad",
    ],
    flujo: [
      "Cuando una actividad de una orden no se puede hacer —no hay refacción, no hay quien, no se pudo parar el equipo— el técnico la libera indicando el motivo.",
      "La actividad se queda marcada en su orden, para que esa orden cuente lo que de verdad pasó, y aparece aquí.",
      "Al armar una orden nueva para ese equipo, el trabajo pendiente se puede retomar.",
      "Si se liberó por falta de una refacción y se indicó cuál, esta pantalla marca «Ya se puede hacer» en cuanto hay existencia.",
    ],
    campos: [
      { nombre: "Ya se puede hacer", explica: "Se liberó por falta de una refacción y hoy sí hay en el almacén. Es la señal de que ese trabajo ya no tiene por qué seguir esperando." },
      { nombre: "De un plan / De una solicitud", explica: "De dónde venía la actividad. Una que viene de un plan es trabajo preventivo que se dejó de hacer, y eso importa más que un pendiente suelto." },
      { nombre: "Liberada hace N días", explica: "Cuánto lleva esperando. Un número que crece sin parar es una refacción que nadie pidió o un servicio que nadie contrató." },
    ],
    noPuedo: [
      { sintoma: "Una actividad no aparece aquí aunque no se hizo", porque: "Solo entran las que se liberaron con motivo. Si la orden sigue abierta, la actividad sigue en ella; el backlog es para lo que ya se decidió posponer." },
      { sintoma: "Desapareció una que estaba aquí", porque: "Otra orden ya la retomó. Se puede seguir la cadena desde la orden nueva hasta la que la liberó." },
    ],
    preguntas: [
      {
        pregunta: "¿Por qué una actividad liberada sigue apareciendo en su orden original?",
        respuesta:
          "A propósito. Si desapareciera, esa orden diría que se hizo todo, y no fue así. La actividad se queda marcada como liberada, con su motivo, para que la orden cuente lo que de verdad pasó ese día. Aquí aparece además como trabajo que sigue esperando.",
      },
      {
        pregunta: "¿Cómo se retoma una actividad pendiente?",
        respuesta:
          "Al crear una orden nueva para ese equipo. El trabajo pendiente aparece disponible para incluirlo. Al retomarlo, la actividad nueva queda ligada a la que se liberó, así que se puede seguir la historia completa.",
      },
      {
        pregunta: "¿Qué significa que una actividad se haya liberado varias veces?",
        respuesta:
          "Que se intentó y se volvió a trabar. Una vez es un contratiempo; tres veces es una señal de que algo no se está resolviendo: una refacción que nadie pidió, un servicio que nadie contrató o un equipo que nunca se puede parar.",
      },
    ],
  },

  "/work-orders": {
    titulo: "Órdenes de trabajo",
    que: "Todo el trabajo de mantenimiento: lo que se planeó, lo que salió mal y lo que ya se hizo.",
    hacer: [
      "Crear una orden correctiva a mano",
      "Filtrar por estado, tipo, prioridad o responsable",
      "Acomodar columnas, agrupar hasta en tres niveles y guardar su vista",
    ],
    flujo: [
      "Las preventivas las genera el programador desde los planes; no se capturan una por una.",
      "Las correctivas nacen de una solicitud, de una alerta predictiva o a mano.",
      "Al cerrarlas, sus horas, refacciones y servicios alimentan el costo por equipo.",
      "En las preventivas, el plan ya dice qué refacciones se van a consumir: la requisición se arma con eso y descuenta lo que ya se pidió o se consumió.",
      "Al pedir, el sistema dice cuánto cubre el almacén y cuánto no, para poder empezar con lo que hay y mandar el resto a compras.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la orden. Es como se le nombra en piso y en cualquier reporte." },
      { nombre: "Descripcion", explica: "El titulo del trabajo y, debajo, el activo al que se le hace. Sin activo, el costo despues no se le puede atribuir a nada." },
      { nombre: "Tipo", explica: "Preventivo nace de un plan; correctivo de una falla; predictivo de una alerta. La mezcla entre ellos es el indicador de si el preventivo esta alcanzando." },
      { nombre: "Prioridad", explica: "Con que urgencia atenderla. No es lo mismo que la criticidad del equipo: un equipo critico puede tener un trabajo que aguanta." },
      { nombre: "Estado", explica: "En que etapa va. Solo las cerradas alimentan los costos y los indicadores." },
      { nombre: "Responsable", explica: "A quien esta asignada. Sin asignar significa que nadie la ha tomado todavia." },
      { nombre: "Vencimiento", explica: "Cuando debio estar hecha. En rojo cuando ya paso, con los dias que lleva vencida." },
      { nombre: "Horas real / est.", explica: "Lo que llevo contra lo que se estimo. Si la real supera a la estimada de forma consistente, el plan esta mal calibrado." },
      { nombre: "Costo total", explica: "Mano de obra mas refacciones mas servicios externos. Se llena solo conforme se carga cada cosa; en cero significa que aun no se registra nada." },
    ],
    botones: [
      { nombre: "Nueva orden", explica: "Da de alta una orden correctiva a mano. Las preventivas no se capturan aqui: las genera el programador." },
      { nombre: "Editar (dentro de la orden)", explica: "Cambia responsable, cuadrilla, tipo, prioridad, activo, fechas, horas estimadas, procedimiento y notas de seguridad. Al asignar responsable, una orden abierta pasa a «asignada» sola." },
      { nombre: "Generar requisición (en preventivas)", explica: "Arma la requisición sola con las refacciones que el plan pide y que todavía no se han pedido ni consumido. Solo hay que revisar, ajustar y enviar." },
      { nombre: "Pedir otra cosa", explica: "Requisición manual desde la misma orden, para lo que el técnico descubre que hace falta y no estaba en el plan." },
      { nombre: "Generar procedimiento (en correctivas)", explica: "Propone cómo asegurar el equipo, los pasos en orden, qué medir y contra qué, y qué refacciones del catálogo llevar. Al aplicarlo, los pasos se vuelven actividades que el técnico va palomeando." },
      { nombre: "Exportar CSV", explica: "Baja lo que esta viendo, con los filtros aplicados, para llevarlo a una hoja de calculo." },
      { nombre: "Los cuatro desplegables de arriba", explica: "Filtran contra la base de datos, no solo lo que ve. Sirven para acotar antes de trabajar." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de nueva orden", porque: "Crear órdenes requiere perfil de supervisor o superior. Un técnico ejecuta, no da de alta." },
      { sintoma: "No me deja editar una orden", porque: "Está cerrada o cancelada. Su historial es el respaldo de lo que costó, y por eso ya no se toca." },
    ],
    preguntas: [
      { pregunta: "¿Por qué no aparecen mis órdenes preventivas?", respuesta: "Las genera el programador desde los planes. Vaya a Planes preventivos y ejecútelo: ahí le dice, plan por plan, por qué generó o por qué no." },
      { pregunta: "¿De dónde saca el procedimiento de una correctiva?", respuesta: "Del equipo, de la falla reportada y —lo más valioso— de las reparaciones anteriores de ese mismo equipo. Lo que ya funcionó ahí vale más que un procedimiento de manual. Las refacciones que sugiere salen de su catálogo, con código: nunca inventa una que no existe." },
      { pregunta: "¿Cómo cargo las refacciones que se usaron?", respuesta: "Dentro de la orden, en el panel de refacciones. Si el material salió por una requisición al almacén, el consumo ya quedó cargado solo." },
    ],
  },

  "/plans": {
    titulo: "Planes preventivos",
    que: "Las rutinas que se repiten: qué se le hace a cada equipo, cada cuánto, con qué refacciones y cuánto cuesta.",
    hacer: [
      "Dar de alta un plan con sus actividades, refacciones, mano de obra y servicios",
      "Generarlo con IA a partir del equipo",
      "Ejecutar el programador para que nazcan las órdenes",
    ],
    flujo: [
      "Un plan no hace nada por sí solo: el programador es el que convierte planes en órdenes.",
      "Cada plan dispara con anticipación: si vence el día 5 y anticipa 3 días, la orden nace el día 2.",
      "Al cerrar la orden generada, el plan recalcula su próximo vencimiento.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Plan", explica: "El nombre con el que lo va a reconocer el tecnico. Debajo van sus referencias y manuales." },
      { nombre: "Activo", explica: "A que equipo se le aplica. Un plan sin activo NO genera ordenes: es el motivo mas comun de que el programador no haga nada." },
      { nombre: "Tipo", explica: "Preventivo, predictivo o inspeccion. Define el tipo con el que nacen sus ordenes." },
      { nombre: "Disparo", explica: "Calendario dispara por dias; medidor por lectura acumulada; condicion espera a que alguien lo decida." },
      { nombre: "Frecuencia", explica: "Cada cuanto toca. Ojo: manda el numero, no el nombre. Un plan llamado mensual con intervalo de 3 dias genera cada tres dias." },
      { nombre: "Proximo", explica: "Cuando vence. La orden nace antes, restando los dias de anticipacion." },
      { nombre: "Actividades", explica: "Cuantos pasos trae la rutina. Cada uno puede llevar su mano de obra, sus refacciones y sus servicios." },
      { nombre: "Costo est.", explica: "Lo que cuesta ejecutarlo una vez, sumando todo. Multiplicado por la frecuencia es lo que cuesta al ano mantener ese equipo." },
      { nombre: "OT generadas", explica: "Cuantas ordenes ha producido. En cero con fecha vencida es senal de que algo lo esta deteniendo." },
    ],
    botones: [
      { nombre: "Ejecutar programador", explica: "Convierte planes en ordenes. Le dice plan por plan si genero o por que no." },
      { nombre: "El desplegable de horizonte", explica: "Por omision genera lo que toca hoy. Ampliarlo a 7 o 30 dias adelanta la generacion, util antes de un puente." },
      { nombre: "Generar con IA", explica: "Propone la rutina completa a partir del equipo: actividades, tiempos, refacciones y frecuencia. Se revisa antes de guardar." },
      { nombre: "Pausar (en cada renglon)", explica: "Deja de generar ordenes sin borrar el plan ni su historial." },
    ],
    noPuedo: [
      { sintoma: "Ejecuté el programador y no generó nada", porque: "El programador ahora le dice el motivo de cada plan. Los más comunes: todavía no entra en la ventana de anticipación, ya existe una orden abierta de ese plan, o el plan no tiene activo asignado." },
      { sintoma: "Genera órdenes demasiado seguido", porque: "Revise el intervalo del plan. Un plan llamado «mensual» con intervalo de 3 días va a generar cada tres días: manda el número, no el nombre." },
    ],
    preguntas: [
      { pregunta: "¿Cómo genero las órdenes de todo el mes de una vez?", respuesta: "En el programador, cambie el horizonte a «Próximos 30 días» antes de ejecutarlo." },
      { pregunta: "¿Por qué un plan dice «fuera de ventana»?", respuesta: "Porque todavía no toca. Vence más adelante y aún no entra en sus días de anticipación. Amplíe el horizonte si quiere adelantarlo." },
    ],
  },

  "/assets": {
    titulo: "Activos",
    que: "El inventario de equipos mantenibles: qué hay, dónde está, qué tan crítico es y qué cuesta mantenerlo.",
    hacer: [
      "Dar de alta equipos a mano o levantarlos con IA a partir de una descripción o fotos",
      "Elegir qué columnas ver, en qué orden, y agrupar hasta en tres niveles",
      "Eliminar un activo capturado por error",
    ],
    flujo: [
      "Todo cuelga de aquí: los planes, las órdenes, las refacciones y los costos se acumulan por activo.",
      "La criticidad decide el orden de atención cuando hay varias cosas detenidas a la vez.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Codigo", explica: "El identificador que se pinta en el equipo. Es como lo va a buscar el tecnico." },
      { nombre: "Activo", explica: "El nombre y, debajo, fabricante y modelo si ya se capturaron de la placa." },
      { nombre: "Criticidad", explica: "A si su falla detiene la operacion o compromete la seguridad; C si se puede vivir sin el unos dias. Decide el orden de atencion cuando hay varias cosas detenidas." },
      { nombre: "Estado", explica: "Operando, degradado, detenido o retirado. Los retirados salen de las listas de trabajo pero conservan su historial." },
      { nombre: "Ubicacion", explica: "Donde esta fisicamente. Es lo que permite armar una ruta de recorrido en vez de ir y venir." },
      { nombre: "OT abiertas", explica: "Trabajo pendiente sobre ese equipo. Varias abiertas a la vez suele ser sintoma de que se atiende el sintoma y no la causa." },
      { nombre: "Planes", explica: "Cuantas rutinas preventivas tiene. En cero, ese equipo solo se atiende cuando ya fallo." },
      { nombre: "Garantia", explica: "Si sigue vigente. Antes de pagar una reparacion conviene revisarlo." },
      { nombre: "Codigo de reporte (en la ficha)", explica: "El QR del equipo, generado solo. Pegado en la maquina, cualquiera reporta una falla sobre ese activo sin cuenta ni contraseña." },
      { nombre: "Recurrencia de fallas (en la ficha)", explica: "Cuántas veces falló, cada cuánto, cuánto costó y si las fallas se están acercando. Sale del historial y no necesita IA. El análisis del patrón sí." },
    ],
    botones: [
      { nombre: "Nuevo activo", explica: "Alta manual, uno por uno." },
      { nombre: "Levantamiento con IA", explica: "Propone el inventario completo a partir de una descripcion de la instalacion y fotos de las areas. Se revisa antes de dar de alta." },
      { nombre: "El bote de basura del renglon", explica: "Elimina un activo capturado por error. Si tiene historial no lo va a dejar, y le dice exactamente que lo detiene." },
    ],
    noPuedo: [
      { sintoma: "No me deja eliminar un activo", porque: "Tiene historial —órdenes, planes, medidores, lecturas o paros—. Esa información es su respaldo de costos. Si el equipo salió de operación, retírelo desde su ficha en vez de eliminarlo: se conserva entero." },
    ],
    preguntas: [
      { pregunta: "¿Qué me dice el análisis de recurrencia?", respuesta: "Lee las resoluciones de las fallas anteriores y busca el hilo común aunque cada técnico lo haya escrito distinto. Lo más valioso que dice es si se está cambiando la misma pieza sin corregir lo que la destruye — cuatro baleros en un año no son mala suerte." },
      { pregunta: "¿Por qué no me deja analizar la recurrencia?", respuesta: "Necesita al menos tres fallas correctivas en el periodo. Con menos no hay patrón que buscar, y un diagnóstico sobre dos fallas sería adivinar." },
      { pregunta: "¿Cuál es la diferencia entre retirar y eliminar?", respuesta: "Retirar es para un equipo que existió y salió de operación: conserva su historial y sus costos. Eliminar es para uno capturado por error, y solo procede si no arrastra nada." },
    ],
  },

  "/inventory": {
    titulo: "Almacén de refacciones",
    que: "Qué hay, en qué almacén, cuánto vale y qué está por acabarse.",
    hacer: [
      "Registrar entradas, salidas y ajustes",
      "Ver la existencia de un almacén específico con el selector de arriba",
      "Entrar al kardex, a los traspasos, a los conteos y a los indicadores",
    ],
    flujo: [
      "La existencia baja sola cuando se surte una requisición o se consume en una orden de trabajo.",
      "Sube cuando se recibe una compra o cuando alguien devuelve lo que no usó.",
      "Cada uno de esos movimientos queda en el kardex con el documento que lo originó.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Codigo", explica: "El identificador interno de la refaccion." },
      { nombre: "Refaccion", explica: "El nombre, su familia y sus adjuntos: fotos, fichas tecnicas y ligas a manuales." },
      { nombre: "Ubicacion", explica: "Donde esta dentro del almacen. Con formato tipo P3-R2-N4 se puede ordenar y armar la ruta del conteo." },
      { nombre: "Existencia", explica: "Cuanto hay. En rojo con etiqueta de reordenar cuando esta en o por debajo del minimo. Con un almacen elegido arriba, es la existencia de ESE almacen." },
      { nombre: "Nivel", explica: "Que tan lleno esta respecto de su maximo. Verde surtido, amarillo bajo minimo, rojo agotado." },
      { nombre: "Costo unit.", explica: "Costo promedio ponderado. Se recalcula solo en cada entrada; las salidas no lo mueven." },
      { nombre: "Valor en piso", explica: "Existencia por costo. Sumado es el dinero detenido en el anaquel." },
    ],
    botones: [
      { nombre: "Kardex", explica: "El libro del almacen: cada movimiento con su saldo y el documento que lo origino." },
      { nombre: "Traspasos", explica: "Mover existencia de un almacen a otro." },
      { nombre: "Conteos", explica: "Contar el anaquel y cuadrarlo contra el sistema." },
      { nombre: "Indicadores", explica: "Como se esta comportando el almacen: nivel de servicio, rotacion, exactitud." },
      { nombre: "Analisis", explica: "Que comprar y que sobra. Es la pantalla de decisiones, no de consulta." },
      { nombre: "Entrada / Salida (en cada renglon)", explica: "Movimiento manual rapido. Aplica al almacen que tenga elegido arriba." },
    ],
    noPuedo: [
      { sintoma: "No me deja sacar una refacción", porque: "No hay suficiente en ESE almacén. Revise si está en otro y haga un traspaso." },
      { sintoma: "No veo el selector de almacenes", porque: "Solo aparece cuando hay más de uno. Dé de alta el segundo en Catálogos → Almacenes." },
    ],
    preguntas: [
      { pregunta: "¿Por qué la existencia cambia sin que yo haga nada?", respuesta: "Porque el consumo en órdenes de trabajo y el surtido de requisiciones descuentan automáticamente. El kardex le dice exactamente qué movimiento fue y quién lo hizo." },
      { pregunta: "¿Cómo sé qué tengo que comprar?", respuesta: "En Análisis: lista lo que está bajo mínimo ordenado por criticidad del equipo que lo consume, y lo que sus planes van a pedir y no tiene." },
    ],
  },

  "/inventory/duplicados": {
    titulo: "Limpieza del catálogo",
    que: "Refacciones que parecen ser la misma pieza capturada varias veces, con distinta redacción.",
    hacer: [
      "Ver los grupos que el sistema encontró por parecido",
      "Revisarlos con IA para separar los que sí son la misma pieza",
      "Fusionar los confirmados en un solo registro",
    ],
    flujo: [
      "El desorden del catálogo es el asesino silencioso del inventario: la existencia se reparte, los mínimos no disparan y el técnico pide una mientras el almacenista surte otra.",
      "El sistema junta candidatos por parecido de texto y descarta los que chocan en medidas: un 6205 y un 6206 nunca se juntan aunque se lean casi igual.",
      "Al fusionar, la existencia se suma almacén por almacén y todo el historial —kardex, consumos, requisiciones— pasa a la que sobrevive.",
    ],
    noPuedo: [
      { sintoma: "No me deja fusionar dos refacciones", porque: "Se miden en unidades distintas. Fusionar piezas con metros produciría una existencia que no significa nada. Corrija la unidad primero." },
    ],
    preguntas: [
      { pregunta: "¿Se puede deshacer una fusión?", respuesta: "No. Por eso nada se fusiona solo: usted confirma viendo exactamente qué se junta y qué existencia queda. La bitácora conserva el rastro de qué absorbió a qué y quién lo decidió." },
      { pregunta: "¿Qué pasa con el historial de las que desaparecen?", respuesta: "Cambia de dueño, no se borra. Los movimientos, los consumos en órdenes y los renglones de requisición pasan a la refacción que sobrevive." },
      { pregunta: "¿Cuándo conviene revisarlo?", respuesta: "Después de importar datos o de un levantamiento con IA, que es cuando entran registros nuevos en volumen." },
    ],
  },

  "/inventory/kardex": {
    titulo: "Kardex de almacén",
    que: "El libro del almacén: cada entrada, salida, devolución y traspaso, con el saldo que dejó.",
    hacer: [
      "Filtrar por refacción, almacén, tipo de movimiento y rango de fechas",
      "Abrir el documento que originó cada movimiento",
      "Ver solo los ajustes, para revisar qué se corrigió a mano",
    ],
    flujo: [
      "Nada se escribe aquí directamente: el kardex es el resultado de lo que pasa en el almacén, las órdenes y las compras.",
      "El saldo que muestra es el del almacén después de ese movimiento — es contra lo que se cuadra un conteo físico.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Movimiento", explica: "Entrada de compra, salida a mantenimiento, devolucion, ajuste de conteo o las dos mitades de un traspaso." },
      { nombre: "Entra / Sale", explica: "Columnas separadas a proposito: es como se lee un kardex y evita confundir el signo." },
      { nombre: "Saldo", explica: "Lo que quedo en ESE almacen despues del movimiento. Es contra lo que se cuadra un conteo fisico." },
      { nombre: "Documento", explica: "El vale, el traspaso o la orden que lo origino. Es liga: lleva al documento completo." },
      { nombre: "Recibio", explica: "A quien se le entrego fisicamente. Puede no ser quien pidio." },
    ],
    preguntas: [
      { pregunta: "¿Quién movió esta refacción?", respuesta: "Filtre por esa refacción. Cada renglón trae quién lo registró, a quién se le entregó y el documento —vale, traspaso u orden— que lo originó." },
    ],
  },

  "/inventory/conteos": {
    titulo: "Conteos cíclicos",
    que: "Contar el anaquel y cuadrarlo contra lo que dice el sistema.",
    hacer: [
      "Abrir un conteo de todo un almacén o de una familia",
      "Capturar a ciegas, sin ver lo que el sistema espera",
      "Cerrar y aplicar los ajustes",
    ],
    flujo: [
      "Al abrir se toma una foto de lo que el sistema cree que hay; contra eso se mide la diferencia.",
      "Al cerrar, cada diferencia produce un ajuste en el kardex con el folio del conteo.",
      "La exactitud que resulte alimenta los indicadores del almacén.",
    ],
    campos: [
      { nombre: "Sistema", explica: "Lo que el sistema creia que habia. Se oculta mientras se cuenta a ciegas." },
      { nombre: "Contado", explica: "Lo que se encontro en el anaquel." },
      { nombre: "Diferencia", explica: "Contado menos sistema, ya cerrado el conteo. En verde sobrante, en rojo faltante." },
      { nombre: "Exactitud", explica: "Que porcentaje de renglones cuadro. Debajo del 85% las decisiones de compra se toman sobre cifras que no corresponden al anaquel." },
    ],
    botones: [
      { nombre: "Abrir conteo", explica: "Toma la foto de lo que el sistema cree que hay y arranca la captura." },
      { nombre: "Contando a ciegas", explica: "Alterna si se ve o no la existencia del sistema. A ciegas es lo correcto para contar; mostrarlo sirve solo para revisar." },
      { nombre: "Guardar avance", explica: "Se puede contar en varias sesiones sin cerrar." },
      { nombre: "Cerrar y ajustar", explica: "Aplica los ajustes al inventario. Queda en el kardex y no se deshace." },
    ],
    noPuedo: [
      { sintoma: "No me deja abrir un conteo", porque: "Ya hay uno abierto en ese almacén. Ciérrelo o cancélelo antes de abrir otro." },
    ],
    preguntas: [
      { pregunta: "¿Por qué no veo la existencia mientras cuento?", respuesta: "A propósito. Si ve el número que el sistema espera, lo escribe — y el conteo deja de medir nada. Puede mostrarlo con el botón de arriba, pero para revisar, no para contar." },
      { pregunta: "¿Qué pasa si alguien surte material mientras cuento?", respuesta: "El sistema lo detecta y lo avisa al cerrar. El ajuste se aplica contra lo que hay en ese momento, no contra la foto vieja: el movimiento legítimo no se borra." },
    ],
  },

  "/requisiciones": {
    titulo: "Requisiciones de material",
    que: "Lo que mantenimiento le pide al almacén, y el vale con el que se entrega.",
    hacer: [
      "Pedir material contra una orden de trabajo o un activo",
      "Surtir completo o en partes, registrando a quién se entrega",
      "Recibir de vuelta lo que no se usó",
    ],
    flujo: [
      "Pedir no descuenta existencia. El almacén baja hasta que se surte.",
      "Lo surtido contra una orden de trabajo se carga solo como consumo de esa orden.",
      "Lo que el almacén no puede cubrir se manda a compras sin volver a capturarlo.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la requisicion, serie RM." },
      { nombre: "Para", explica: "La orden de trabajo o el activo al que se destina el material, y el motivo." },
      { nombre: "Estado", explica: "Se calcula de los renglones, no se captura: solicitada, surtida en parte, surtida." },
      { nombre: "Urgencia", explica: "Normal, alta o equipo parado. Las de paro salen resaltadas y se cuentan aparte arriba." },
      { nombre: "Por surtir", explica: "Lo que falta entregar. Es la columna que le dice al almacenista que tiene pendiente." },
      { nombre: "Devuelto", explica: "Lo que regreso sin usarse. Mucha devolucion significa que se esta pidiendo de mas por si acaso." },
    ],
    botones: [
      { nombre: "Nueva requisicion", explica: "Pedir material. Ofrece solo lo que existe en el almacen elegido, con su cantidad disponible. Al elegir orden de trabajo, el activo se toma de ella: no hay que capturarlo dos veces." },
      { nombre: "Surtir", explica: "Entrega el material y descuenta del almacen. Propone lo que falta, ya recortado a lo que hay." },
      { nombre: "Registrar devolucion", explica: "Regresa al inventario lo que se entrego y no se uso." },
      { nombre: "Solicitar a compras", explica: "Aparece cuando el almacen no puede cubrir algo. Manda los renglones faltantes con su cantidad ya cargada." },
      { nombre: "Cerrar requisicion", explica: "Da por terminado el asunto: ya no se espera mas movimiento contra ella." },
    ],
    noPuedo: [
      { sintoma: "No me deja crear la requisición sin orden ni activo", porque: "Material que sale sin destino es un costo que después nadie puede atribuir. Con una orden de trabajo basta: el activo lo hereda de ella." },
      { sintoma: "No me deja surtir", porque: "O no hay suficiente en el almacén de la requisición, o la refacción no está en el catálogo. En el segundo caso hay que darla de alta o solicitarla a compras." },
      { sintoma: "No veo el botón de surtir", porque: "Surtir mueve existencia y requiere permiso de almacén. Quien pide no es quien entrega." },
    ],
    preguntas: [
      { pregunta: "¿Puedo pedir algo que no está en el catálogo?", respuesta: "Sí, descríbalo con palabras. No se puede surtir del almacén, pero sí mandarlo a compras — es como llega a compras lo que todavía nadie ha dado de alta." },
      { pregunta: "¿Por qué me pregunta a quién se entrega?", respuesta: "Porque el que recoge no siempre es el que pidió, y el vale necesita responsable. Después le permite filtrar quién consume más y quién nunca devuelve." },
    ],
  },

  "/compras": {
    titulo: "Requisiciones de compra",
    que: "Lo que el almacén no tuvo y hay que adquirir, con quién lo autorizó y qué llegó.",
    hacer: [
      "Solicitar una compra, casi siempre desde una requisición que no se pudo surtir",
      "Autorizar o rechazar con motivo",
      "Anotar la orden de compra y recibir la mercancía",
    ],
    flujo: [
      "Si el proceso interno de compras está apagado, se anota el folio de la orden de su propio sistema y salta a recepción.",
      "Si está encendido, entre autorizar y recibir van las cotizaciones, el comparativo y la orden de compra.",
      "Al recibir, la existencia sube y el costo promedio de la refacción se recalcula.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la requisicion de compra, serie RC." },
      { nombre: "Estado", explica: "Solicitada espera firma; autorizada espera que se coloque; en compra espera que llegue." },
      { nombre: "Monto estimado", explica: "Lo que se calcula que va a costar. Al elegir cotizacion ganadora se sustituye por el monto real cotizado." },
      { nombre: "Por recibir", explica: "Lo que se pidio y todavia no llega." },
      { nombre: "Orden de compra", explica: "El folio con el que se comprometio al proveedor. Puede ser la que emite MainTrack o la de su propio sistema." },
    ],
    botones: [
      { nombre: "Autorizar / Rechazar", explica: "La firma. Rechazar exige motivo, y el motivo le llega a quien pidio. Nadie puede firmar su propia requisicion." },
      { nombre: "Anotar orden del ERP", explica: "Cuando compras vive afuera: se guarda el folio de la orden externa y se salta a recepcion sin perder trazabilidad." },
      { nombre: "Capturar cotizacion", explica: "Solo con el proceso interno encendido. Registra lo que ofrecio un proveedor para armar el comparativo." },
      { nombre: "Elegir esta", explica: "Marca la cotizacion ganadora. Si no es la mas barata, exige explicar por que." },
      { nombre: "Emitir orden de compra", explica: "Genera la orden formal con el proveedor ganador, heredando total, condiciones y fecha prometida." },
      { nombre: "Recibir material", explica: "Registra lo que llego contra lo que se pidio, con remision y revision fisica. Sube la existencia y recalcula el costo promedio." },
    ],
    noPuedo: [
      { sintoma: "No me deja autorizar", porque: "O usted la solicitó —nadie firma su propia compra— o no tiene permiso de autorización, que es de administrador o propietario." },
      { sintoma: "No me deja elegir una cotización", porque: "Si no es la más barata, hay que explicar por qué. Es lo único que defiende la decisión cuando alguien la revise después." },
    ],
    preguntas: [
      { pregunta: "¿Cómo prendo o apago el proceso interno de compras?", respuesta: "En Configuración → Organización, en la tarjeta «Proceso de compras». Apagado es lo correcto si su empresa ya compra en otro sistema." },
    ],
  },

  "/suppliers": {
    titulo: "Proveedores",
    que: "Quién surte las refacciones y quién presta los servicios externos, con lo que cada uno representa.",
    hacer: [
      "Dar de alta y editar proveedores con sus condiciones",
      "Ver cuántas refacciones surte cada uno y cuántas están bajo mínimo",
      "Ver el gasto acumulado y el último servicio",
    ],
    flujo: [
      "La columna «Bajo mínimo» convierte esta lista en una orden de compra por renglón: es a quién hay que llamarle hoy.",
      "El gasto sale de los servicios externos cargados a órdenes de trabajo.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Dias de entrega", explica: "Lo que el proveedor dice que tarda. Los indicadores le muestran lo que tarda de verdad." },
      { nombre: "Bajo minimo", explica: "Cuantas de sus refacciones estan por acabarse. Es una orden de compra por renglon: a quien hay que llamarle hoy." },
      { nombre: "Valor en piso", explica: "Cuanto inventario suyo tiene detenido en el almacen." },
      { nombre: "Gasto acumulado", explica: "Lo que se le ha pagado en servicios externos cargados a ordenes." },
    ],
    noPuedo: [
      { sintoma: "No me deja borrar un proveedor", porque: "Tiene refacciones o servicios ligados. Ese es el rastro de a quién se le compró. Reasigne lo que le cuelga primero." },
    ],
  },

  "/requests": {
    titulo: "Solicitudes de servicio",
    que: "Lo que reporta quien no es de mantenimiento: se revisa y se convierte en orden, o se descarta.",
    hacer: [
      "Levantar una solicitud a mano",
      "Revisarla y convertirla en orden de trabajo",
      "Analizar con IA lo que llegó por el portal público",
    ],
    flujo: [
      "Es la puerta de entrada del trabajo correctivo desde el resto de la empresa.",
      "Lo que llega por código QR trae ya el sitio, el área y el equipo, más la foto de quien reportó.",
      "Al recibir, el sistema revisa el texto en busca de condiciones de riesgo —gas, cable expuesto, humo— y si encuentra alguna, el aviso sale como crítico de inmediato.",
      "Al aprobarla nace una orden de trabajo con su folio propio.",
    ],
    campos: [
      { nombre: "Posible condición de riesgo", explica: "Aparece en rojo cuando lo reportado menciona algo peligroso. Se detecta al recibir, en el acto y sin IA, porque un «huele a gas» no puede esperar a que alguien abra la bandeja." },
      { nombre: "Triage", explica: "La propuesta de la IA: título en lenguaje de mantenimiento, prioridad por consecuencia, tipo, y qué conviene llevar. Nada se aplica solo." },
      { nombre: "Posible duplicado", explica: "Otra solicitud abierta que reporta el mismo problema. Tres personas reportando el mismo aire se atienden como una." },
    ],
    botones: [
      { nombre: "Analizar con IA", explica: "Lee lo reportado y la foto, y propone la clasificación. Se guarda para no volver a pagarlo cada vez que alguien mire la misma solicitud." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de analizar", porque: "El triage con IA se incluye en los planes con inteligencia artificial. La detección de riesgo, en cambio, funciona en todos los planes porque no usa IA." },
    ],
    preguntas: [
      { pregunta: "¿La IA cambia la solicitud sola?", respuesta: "No. Todo lo que propone es sugerencia; usted decide al aprobarla. Una solicitud mal clasificada por una máquina sin que nadie mire es peor que una sin clasificar." },
    ],
  },

  "/calendar": {
    titulo: "Calendario de mantenimiento",
    que: "Lo que está programado, lo que se proyecta y si de verdad cabe en los días que quedan.",
    hacer: [
      "Ver el mes completo, o la semana con el trabajo de cada persona",
      "Abrir cualquier día para ver todo lo que cae ahí",
      "Filtrar por técnico, tipo de mantenimiento o solo lo abierto",
      "Ver la carga de cada persona y qué días no alcanzan",
      "Generar las órdenes de los planes que ya vencen",
    ],
    flujo: [
      "Las órdenes se pintan en su fecha compromiso, con el color de su tipo y un punto del color del responsable.",
      "Las proyecciones con línea punteada son planes que todavía no generan orden: aparecen para que se vea lo que viene.",
      "Lo vencido y sin cerrar sale arriba siempre, sin importar el mes que esté viendo. Se quedaba escondido en el mes en que venció.",
      "Un día en ámbar es un día donde a alguien no le cabe el trabajo asignado.",
      "La vista de semana pone a cada persona en su renglón: ahí se ve si alguien trae tres días saturados mientras otro está libre. En el mes eso queda escondido porque todo se mezcla por día.",
      "El botón «Ejecutar programador» crea las órdenes de los planes que ya vencieron, y dice por qué saltó las que no generó.",
    ],
    campos: [
      { nombre: "Las horas de la esquina del día", explica: "La suma de horas estimadas de lo asignado ese día. En ámbar cuando alguien pasa de su jornada." },
      { nombre: "Punto de color", explica: "El responsable de esa orden. Sirve para ver de un vistazo cómo está repartido el trabajo." },
      { nombre: "Días en gris", explica: "No laborables: fin de semana o festivo, según lo que tenga configurado su empresa. El programador ya no proyecta ahí." },
      { nombre: "Barra de cada persona", explica: "Al abrir un día: horas asignadas contra sus horas disponibles. En ámbar significa que ese día no le cabe." },
    ],
    noPuedo: [
      { sintoma: "No veo todas las órdenes de un día", porque: "La celda del mes muestra las primeras; toque el día y se abre completo abajo, con la carga por persona." },
      { sintoma: "Un día aparece sobrecargado y no entiendo por qué", porque: "Ábralo. La barra de cada persona muestra sus horas contra su jornada. Puede ser una sola persona con demasiado, aunque el equipo tenga holgura." },
      { sintoma: "Trabajo programado en sábado sale marcado", porque: "Ese día tiene capacidad cero según su configuración. Si su empresa sí trabaja sábados, ajústelo en la jornada de la organización." },
    ],
    preguntas: [
      {
        pregunta: "¿De dónde salen las horas disponibles de cada persona?",
        respuesta:
          "De la jornada de la organización, que es el valor general. Si alguien tiene un horario distinto, se le puede poner su propio número y ese manda. Se define por excepción: no hay que llenar un campo por cada empleado.",
      },
      {
        pregunta: "¿Por qué un día puede verse sobrecargado si el equipo tiene gente libre?",
        respuesta:
          "Porque la carga se mide por persona, no por equipo. Si a un técnico le tocan diez horas y a otro ninguna, el día está sobrecargado aunque en total sobre capacidad. El problema no es que falte gente, es cómo está repartido.",
      },
      {
        pregunta: "¿Qué pasa si un preventivo cae en domingo o en un festivo?",
        respuesta:
          "El programador lo recorre al siguiente día laborable. Hacia adelante y nunca hacia atrás: adelantar un mantenimiento sin que nadie lo pida sería cambiar el plan por cuenta propia. Los festivos de ley vienen cargados y su empresa puede agregar los suyos.",
      },
    ],
  },

  "/board": {
    titulo: "Tablero",
    que: "Las órdenes por estado, para mover trabajo de una etapa a otra.",
    hacer: ["Arrastrar órdenes entre columnas para cambiar su estado"],
    flujo: ["Es la misma información que la lista de órdenes, vista por avance en vez de por renglones."],
  },

  "/meters": {
    titulo: "Medidores",
    que: "Las lecturas de horas, kilómetros o ciclos que disparan mantenimiento por uso.",
    hacer: ["Capturar lecturas", "Ver la tendencia de consumo"],
    flujo: [
      "Un plan por medidor no dispara por calendario sino cuando la lectura alcanza el intervalo.",
      "Sin lecturas al día, esos planes no generan nunca.",
    ],
  },

  "/predictive": {
    titulo: "Predictivo",
    que: "Sensores y tendencias que avisan antes de que algo falle.",
    hacer: ["Registrar sensores y sus lecturas", "Ver qué variables se están saliendo de rango"],
    flujo: ["Cuando una tendencia cruza el umbral, se genera una alerta; de la alerta puede nacer una orden."],
  },

  "/alerts": {
    titulo: "Alertas",
    que: "Lo que el sistema detectó y necesita que alguien decida.",
    hacer: ["Revisar la alerta", "Convertirla en orden de trabajo o darla por atendida"],
    flujo: ["Vienen del predictivo y de las revisiones automáticas. No se capturan a mano."],
  },

  "/consulta": {
    titulo: "Pregunte a sus datos",
    que: "Preguntas en español sobre su propia operación, contestadas con sus datos reales.",
    hacer: [
      "Preguntar cosas como «¿qué equipo me costó más este trimestre?» o «¿qué refacciones se acabaron?»",
    ],
    flujo: [
      "No inventa: consulta sus órdenes, activos, almacén y costos con herramientas de solo lectura.",
      "Nunca ve datos de otra empresa: la organización la pone el servidor, no la pregunta.",
    ],
  },

  "/diagnostico": {
    titulo: "Diagnóstico con IA",
    que: "Un análisis del estado de la operación, con fortalezas, riesgos y qué atender primero.",
    hacer: ["Generar el diagnóstico del periodo", "Revisar las áreas de oportunidad"],
    flujo: [
      "Los números se calculan en el sistema; la IA los interpreta pero no los inventa.",
      "Se genera solo cada semana, y puede pedirlo cuando quiera.",
    ],
  },

  "/reports": {
    titulo: "Reportes",
    que: "Los cortes de información para llevar a una junta o a un cierre de mes.",
    hacer: ["Elegir periodo y exportar"],
    flujo: ["Todo sale de las órdenes cerradas y del kardex. Si un número no cuadra, el kardex lo explica."],
  },

  "/catalogs": {
    titulo: "Catálogos",
    que: "Las listas que alimentan el resto del sistema: sitios, ubicaciones, almacenes, categorías, causas de falla, cuadrillas.",
    hacer: ["Dar de alta y editar cada catálogo", "Borrar los que no estén en uso"],
    flujo: [
      "Un catálogo limpio es lo que después permite agrupar y comparar. Texto libre no se puede agrupar.",
      "Los proveedores tienen pantalla propia porque a ellos les cuelga información real.",
    ],
    noPuedo: [
      { sintoma: "No me deja borrar un registro", porque: "Algo lo está usando. El mensaje le dice exactamente qué y cuántos." },
    ],
  },

  "/settings": {
    titulo: "Configuración",
    que: "Su cuenta, la organización, los usuarios, el plan y la bitácora.",
    hacer: [
      "Cambiar tamaño de letra y densidad —eso es suyo, no de la empresa—",
      "Configurar logotipo, color, proceso de compras y umbral de autorización",
      "Definir la jornada, los días laborables y los días que la empresa no trabaja",
      "Dar de alta usuarios y revisar la bitácora",
    ],
    flujo: [
      "Los permisos van por rol. Cambiar el rol de alguien cambia lo que puede hacer en todas las pantallas.",
      "En «Jornada y calendario» se define de cuántas horas es un día de trabajo. De ahí sale si un día del calendario cabe y en qué fechas puede programar el programador.",
      "La capacidad se define por excepción: la organización fija el número general y solo quien trabaje distinto lleva el suyo.",
    ],
  },

  "/glossary": {
    titulo: "Glosario",
    que: "Qué significa cada término del sistema, en el lenguaje de mantenimiento.",
    hacer: ["Consultar un término"],
    flujo: ["Si algo en otra pantalla no se entiende, probablemente esté aquí."],
  },

  "/puesta-en-marcha": {
    titulo: "Puesta en marcha",
    que: "Los pasos para dejar el sistema operando, con el avance de cada uno.",
    hacer: ["Ver qué falta y entrar directo a resolverlo"],
    flujo: ["El sistema palomea solo cada paso cuando detecta que ya está hecho. No hay que marcar nada a mano."],
  },
};

/**
 * Pantallas sin ficha a proposito.
 *
 * Una vista de impresion no tiene nada que explicar: es una salida, no una
 * pantalla con la que se interactua. Se listan aqui para que la revision
 * distinga entre "no lleva ayuda" y "se nos olvido".
 */
export const SIN_AYUDA = [
  "/work-orders/[id]/print",
  "/billing/[id]/print",
  "/requests/puntos/imprimir",
  "/clients/cobranza",
  "/clients/ia",
];

/** La ficha de una ruta, cayendo a la sección padre cuando no hay exacta. */
export function ayudaDe(ruta: string): FichaAyuda | null {
  if (AYUDA[ruta]) return AYUDA[ruta];
  // /work-orders/abc123 hereda la ayuda de /work-orders.
  const partes = ruta.split("/").filter(Boolean);
  while (partes.length) {
    partes.pop();
    const padre = `/${partes.join("/")}`;
    if (AYUDA[padre]) return AYUDA[padre];
  }
  return null;
}
