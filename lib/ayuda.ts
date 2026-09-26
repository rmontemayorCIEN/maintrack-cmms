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
  /**
   * Si la pantalla tiene campos que despliegan un catalogo largo. Se explican
   * una sola vez, en CAMPO_BUSCABLE, en vez de repetirse en dieciseis fichas.
   */
  camposBuscables?: boolean;
  noPuedo?: Array<{ sintoma: string; porque: string }>;
  /** Preguntas que el usuario suele hacer aqui. Se contestan sin llamar al modelo. */
  preguntas?: Array<{ pregunta: string; respuesta: string }>;
};

/** Los controles que comparten todas las listas configurables. */
/**
 * Los campos que despliegan un catalogo largo —equipos, refacciones,
 * proveedores— se explican una sola vez, igual que los controles de tabla.
 */
export const CAMPO_BUSCABLE = {
  titulo: "Los campos con lista larga",
  explica:
    "Equipos, refacciones y proveedores no se eligen recorriendo la lista: al abrirlos aparece un buscador. " +
    "Escriba la clave o cualquier palabra del nombre y la lista se reduce sola. " +
    "Puede escribir varias palabras en cualquier orden —«bomba 001» encuentra «BOM-001 — Bomba hidroneumática»— " +
    "y no hace falta poner acentos: «climatizacion» encuentra «climatización».",
} as const;

export const CONTROLES_TABLA: Array<{ nombre: string; explica: string }> = [
  { nombre: "Ordenar", explica: "Toque el titulo de una columna y la lista se ordena por ella; otro toque la invierte; el tercero quita el orden y la deja como llego. La flecha aparece solo en la columna que manda. Los montos y las fechas se ordenan por su valor, no como texto: 900 va antes que 1,200 y enero antes que febrero. Si hay grupos, el orden vale dentro de cada grupo." },
  { nombre: "Filtrar", explica: "Busca en TODAS las columnas, incluidas las que tiene ocultas. Esconder una columna es decision de presentacion, no de que se puede encontrar." },
  { nombre: "Agrupar por…", explica: "Junta los renglones por el criterio que elija. Cada grupo trae su conteo y se pliega con un clic." },
  { nombre: "+ nivel 2 y + nivel 3", explica: "Agrupa dentro de lo agrupado, hasta tres niveles. Por ejemplo Sitio › Categoría › Criticidad." },
  { nombre: "Contraer todo / Expandir todo", explica: "Cierra o abre todos los grupos de golpe. Contraer cierra todos los niveles, para bajar de nivel en nivel al volver a abrir." },
  { nombre: "Columnas", explica: "Prende, apaga y acomoda columnas con las flechas. Las dos primeras son fijas: sin ellas la tabla deja de identificar de que habla." },
  { nombre: "Guardar vista", explica: "Deja su arreglo permanente: columnas, grupos y el orden que haya elegido. Es SUYO, no de la empresa: el almacenista y el jefe de mantenimiento no miran lo mismo." },
  { nombre: "De fabrica", explica: "Regresa a las columnas originales y quita la agrupación." },
];

export const AYUDA: Record<string, FichaAyuda> = {
  "/requests/puntos": {
    titulo: "Puntos de reporte QR",
    camposBuscables: true,
    que: "Códigos QR para pegar en máquinas y áreas. Quien los escanea reporta una falla sin cuenta ni contraseña.",
    hacer: [
      "Crear un punto para un lugar sin equipo registrado: un salón, un baño, un pasillo",
      "Imprimir la hoja con todos los códigos, lista para recortar y pegar",
      "Ver de cuál punto salen más reportes",
      "Decidir qué muestra cada código a quien lo escanea",
    ],
    flujo: [
      "Cada activo genera su propio código solo, la primera vez que se abre su ficha. Aquí no hay que darlo de alta.",
      "Quien escanea no elige sitio ni equipo: el código ya los trae, y por eso no necesita saber cómo se llama la máquina.",
      "El reporte cae en Solicitudes con estado pendiente y avisa por la campanita a propietarios, administradores y supervisores.",
      "Una solicitud nunca se vuelve orden sola: alguien de mantenimiento la revisa primero.",
      "Un código pegado en un pasillo lo lee cualquiera, así que por omisión muestra lo mínimo: la clave del equipo, o el nombre del punto cuando es de un lugar. El nombre de la empresa, la planta y el nombre completo del equipo se encienden uno por uno en «Qué muestra al escanear», y el cambio queda en la bitácora.",
      "Apagar esas opciones no le quita información al reporte: la solicitud sigue llegando con su equipo, su área y su planta. Solo cambia lo que ve quien escanea.",
      "El formulario público trae el aviso de qué se hace con los datos de quien reporta, con enlace al aviso de privacidad de la empresa —si lo configuró— o al del sistema.",
      "Hay freno contra envíos en cadena: por código y por dispositivo. Un código inventado, uno vencido y uno desactivado responden igual, para no confirmarle nada a quien ande tanteando.",
    ],
    campos: [
      { nombre: "Nombre del punto", explica: "Como lo va a reconocer quien lo pega. En los puntos de un lugar —un baño, un pasillo— es ademas lo unico que ve quien escanea, asi que conviene que diga el area sin revelar de mas. En los puntos de un equipo no se muestra: ahi sale la clave del equipo." },
      { nombre: "Qué muestra al escanear", explica: "Tres interruptores por codigo: el nombre de la empresa, la planta y la ubicacion, y el nombre completo del equipo. Apagados —como nacen— el QR solo enseña la clave del equipo o el nombre del punto. Encenderlos es una decision sobre informacion que puede ver cualquiera que pase, y por eso queda registrada." },
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
      { pregunta: "¿Quién reporta necesita cuenta?", respuesta: "No. Ese es el punto: un inquilino o un empleado no va a crear una cuenta por una llave que gotea. Solo deja su nombre y su celular para poder llamarle." },
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

  "/inventory/proyeccion": {
    titulo: "Lo que va a pedir el preventivo",
    que: "Las refacciones que los planes van a consumir en los próximos meses, con la fecha en que tocan. Es para comprar antes de que haga falta, no cuando ya paró el equipo.",
    hacer: [
      "Ver qué refacciones se van a necesitar y cuándo",
      "Elegir el horizonte: 3 meses, 6 meses o un año",
      "Verlo por semana, por mes o por trimestre",
      "Saber cuánto NO alcanza con lo que hay hoy",
    ],
    flujo: [
      "Sale de cruzar dos cosas que el sistema ya sabía por separado: el calendario de qué actividad toca en qué equipo y qué día, y las refacciones que cada actividad tiene cargadas. Es la misma proyección que pinta el calendario, no un cálculo aparte: si fueran dos, un día dejarían de coincidir y nadie sabría cuál vale.",
      "Arriba dice SIEMPRE a cuántas actividades cubre. Si los planes no tienen refacciones cargadas, la tabla sale corta y eso se leería como «no hay que comprar nada», que es lo contrario de la verdad. Mientras la cobertura sea baja, la cifra es un piso.",
      "Para subir la cobertura se cargan las refacciones en cada plan, en «Recursos» de la actividad: qué se consume y cuánto. Los planes que redactó la IA ya las traen; los que se importaron o se capturaron a mano, normalmente no.",
      "«Falta» es lo que NO alcanza: lo que va a consumir más el mínimo, menos lo que hay hoy. Si hay doce y el plan va a pedir ocho, no hay nada que comprar por este concepto. El mínimo entra porque quedarse en cero justo cuando toca el preventivo es igual que no tenerlo.",
      "El orden es por lo que más pesa en dinero, no por cantidad: veinte tornillos no son el problema, un rodamiento de doce mil sí.",
      "Esto es lo que el PLAN compromete, no el consumo total del almacén. Lo correctivo no se puede proyectar —una falla no tiene fecha— así que comprar exactamente esta cantidad deja sin margen el día que algo se rompa.",
      "Solo entran los planes por calendario con equipos asignados y fecha próxima. Los planes por medidor dependen del uso y se proyectan en Predictivo.",
    ],
    campos: [
      { nombre: "Hay", explica: "La existencia actual de esa refacción, sumando todos los almacenes." },
      { nombre: "Falta", explica: "Cuánto comprar para llegar al horizonte sin quedarse corto, contando el mínimo. En blanco significa que alcanza con lo que hay." },
      { nombre: "Las columnas de periodo", explica: "Cuánto cae en cada tramo. La primera es la más cercana y es la que decide si hay que pedir hoy: si el tiempo de entrega del proveedor es de dos semanas, lo de la primera columna ya va tarde." },
    ],
  },
  "/inventory/analisis": {
    titulo: "Análisis de almacén",
    camposBuscables: true,
    que: "Qué comprar, qué sobra y qué está a punto de detener un trabajo. Es la pantalla de decisiones, no de consulta.",
    hacer: ["Revisar cada lista y actuar sobre lo que aparece"],
    flujo: [
      "Cruza la existencia con lo que piden sus planes, con la criticidad del equipo que la consume y con el tiempo de entrega del proveedor.",
      "El mínimo útil es el que alcanza para una intervención completa más el tiempo de entrega, no un número redondo.",
    ],
  },

  "/work-orders/new": {
    titulo: "Nueva orden de trabajo",
    camposBuscables: true,
    que: "Dar de alta una orden correctiva a mano.",
    hacer: ["Capturar el trabajo, el equipo, la prioridad y a quién se asigna"],
    flujo: [
      "Las preventivas no se capturan aquí: las genera el programador desde los planes.",
      "Sin activo, el costo de esta orden después no se le puede atribuir a ningún equipo.",
    ],
  },

  "/import": {
    titulo: "Importar datos",
    que: "Cargar sitios, activos, usuarios, almacenes, medidores y lecturas, refacciones y existencias, planes, proveedores y catálogos desde Excel (.xlsx) o CSV, con vista previa y reversión.",
    hacer: [
      "Bajar la plantilla en Excel o en CSV, llenarla y subirla: las dos se leen con las mismas reglas",
      "Revisar la vista previa: qué es nuevo, qué ya existe, qué parece duplicado y qué tiene error",
      "Decidir los duplicados: omitirlos, actualizar los existentes o crear uno que se parece pero es distinto",
      "Ver cada error con su fila, columna, el valor que traía, el problema y cómo corregirlo; descargar ese detalle, corregir y volver a validar",
      "Revertir una importación desde el historial",
    ],
    flujo: [
      "Validar no guarda ningún dato: solo deja la entrada «validada» en el historial. Se puede elegir el mismo archivo las veces que haga falta.",
      "La política es una y se dice antes de confirmar: con un solo renglón rechazado no se importa nada. Se corrige el archivo y se vuelve a subir. Así nunca queda una carga a medias.",
      "El historial dice en qué quedó cada archivo: validada, confirmada, completada, completada con advertencias, fallida, revertida, reversión parcial o reversión bloqueada.",
      "Usuarios: nunca se importan contraseñas —la columna se ignora—. Después de importarlos, genere a cada persona su liga de acceso en Configuración → Usuarios.",
      "Lecturas y existencias iniciales pasan por las mismas reglas que la captura: una lectura menor que la anterior o imposible se rechaza, y cada existencia entra al kardex como movimiento con su costo.",
      "Se guarda todo o nada. Si algo falla a la mitad —un corte, un registro que alguien creó al mismo tiempo—, no queda ningún renglón.",
      "Duplicado exacto: la misma clave (el mismo TAG, el mismo código). Posible duplicado: otra clave, pero el mismo nombre en la misma ubicación, el mismo número de serie, el mismo RFC o, en planes, el mismo equipo con la misma frecuencia. Los posibles se omiten salvo que usted marque «crearlo de todos modos». Nada se combina solo.",
      "Hay orden: los activos necesitan sus sitios, las refacciones sus unidades, y los planes sus activos.",
      "Revertir deshace solo lo que la importación creó y nadie ha usado. Un equipo con órdenes, una refacción con movimientos o un usuario que ya entró se queda, y se le dice por qué. Una lectura no se borra, se anula; una existencia no se borra del kardex, se compensa con una salida. Lo que la importación actualizó no se regresa: se le muestra para que lo revise.",
    ],
    campos: [
      { nombre: "Fechas", explica: "dd/mm/aaaa, por ejemplo 15/09/2026. Una fecha que no existe —30 de febrero— se rechaza en lugar de moverse al día siguiente." },
      { nombre: "Números", explica: "Con punto decimal: 1.5. La coma solo separa miles: 1,250.50. «1,5» se rechaza porque no se sabe si es uno y medio o quince." },
      { nombre: "Unidades", explica: "«Pieza», «pz» y «PZA» se reconocen como la misma unidad, pero tiene que existir en su catálogo de unidades." },
      { nombre: "Dato opcional mal escrito", explica: "Si una fecha de compra o un teléfono vienen mal, el registro se crea sin ese dato y se le avisa; no se detiene la carga por un dato que no era obligatorio." },
    ],
  },

  "/notificaciones": {
    titulo: "Avisos",
    que: "Todo lo que el sistema le ha avisado, con qué tan urgente es, de qué módulo viene y si ya se atendió.",
    hacer: [
      "Ver primero lo pendiente de atención; filtrar por prioridad, módulo o fecha",
      "Abrir el registro relacionado desde cada aviso",
      "Marcar uno o todos como leídos",
      "Decir «Enterado» en un aviso que pide acción",
    ],
    flujo: [
      "Leer no es atender. Un aviso que pide acción sigue pendiente hasta que se resuelve lo que lo originó —la orden se inicia, la compra se autoriza, la refacción se repone— y entonces se marca «atendida» solo, con el motivo.",
      "«Enterado» deja dicho que ya lo vio. En las situaciones donde con eso basta (una alerta crítica, una orden crítica sin aceptar) detiene los recordatorios; el problema sigue pendiente hasta resolverse.",
      "Editar o reprogramar una orden no atiende su aviso por sí solo. Una OT vencida queda atendida cuando se termina, se cierra, se cancela o se reprograma a una fecha futura; reprogramarla a otra fecha que ya pasó la deja vencida, en el mismo aviso con la fecha nueva.",
      "«Vencida» y «vencida sin movimiento» son dos avisos. El segundo se atiende con un avance real —iniciarla, una actividad, horas, material, un cambio de estado— aunque la orden siga vencida; comentar o cambiar un campo no cuenta.",
      "Si la orden cambia de responsable, el aviso de quien la tenía se cierra por reasignación y el nuevo responsable recibe el suyo.",
      "Si el mismo problema sigue, no llegan avisos nuevos: se actualiza el mismo, y dice cuántas veces se le ha recordado. Si se resolvió y vuelve a pasar, se reabre.",
      "El resumen diario muestra cada registro una sola vez, en la sección que más le toca: Mis pendientes, Pendientes que debo autorizar, Pendientes de mi equipo, Situaciones generales de la empresa o Información relevante.",
      "Cada aviso dice qué pasó, por qué importa, qué hacer y desde cuándo. La prioridad sale de reglas fijas: la de la orden, la criticidad del equipo, el tiempo vencido, si hay un equipo parado. Estar vencido sube la prioridad pero no vuelve crítico a nada por sí solo.",
    ],
    campos: [
      { nombre: "Prioridad", explica: "Informativa, baja, media, alta o crítica. Lo crítico llega a cualquier hora; lo demás, dentro del horario de avisos." },
      { nombre: "Pendiente / Atendida", explica: "Pendiente: pide acción y la causa sigue ahí. Atendida: la causa se resolvió; se dice cómo." },
    ],
  },

  "/search": {
    titulo: "Búsqueda",
    que: "Encontrar una orden por su folio, un equipo por su código, nombre o número de serie, una refacción, una solicitud o un proveedor.",
    hacer: ["Escribir parte del código, del nombre o del folio", "Abrir el resultado; «atrás» regresa a donde estaba"],
    flujo: [
      "No importan acentos ni mayúsculas: «valvula» encuentra «Válvula».",
      "Solo aparece lo que su rol puede abrir, y siempre de su empresa: quien reporta encuentra sus reportes, no los de otros.",
      "El folio exacto sale primero. Cada registro aparece una sola vez.",
      "Para preguntas en lenguaje natural, use Pregunte a sus datos.",
      "El micrófono de la barra de arriba sirve para las dos cosas: llevarlo a donde pida —«llévame a las órdenes vencidas», «ábreme el almacén», «enséñame la bomba 3»— y contestarle preguntas sobre sus datos —«cuánto llevo gastado en el compresor», «por qué se paró la línea 2»—. Lo que decide es cómo empiece la frase: «llévame» o «ábreme» es ir; «cuánto», «cuántas» o «por qué» es preguntar.",
      "Mientras revisa sus datos no lo deja en silencio: un pulso suave acompaña la espera hasta que tiene la respuesta. Una pregunta de las que consultan muchas cosas tarda más de treinta segundos, y sin nada que suene eso parece que se cortó.",
      "Si pidió ir a algún lado le dice «vamos para allá» antes de llevarlo. Es la forma de saber cuál de las dos cosas entendió —ir o contestar— sin esperar a que la pantalla cambie.",
      "De omisión contesta CONCISO: dice lo que usted preguntó, en unos diez o quince segundos, y deja el detalle escrito en pantalla. Se cambia en Ajustes → Apariencia. Medido con «¿cuántos activos tenemos?»: la respuesta completa dura 40 segundos hablada y la concisa 10, con la misma cifra.",
      "Un tono corto avisa el instante exacto en que empieza a oírlo: hable después de ese tono. Le contesta HABLANDO, con la voz que usted escogió en Ajustes → Apariencia, y la respuesta también queda escrita para comprobar una cifra.",
      "Una vez que lo toca, sigue escuchando: al terminar de atender lo que dijo vuelve a escuchar sin que usted toque nada. Se detiene al cerrarlo, al cambiar de pantalla, si dos veces seguidas no le entiende, o si pasan doce segundos sin que nadie hable —así no se queda el micrófono abierto si usted se distrajo—.",
      "«Llévame a la orden de trabajo 11» abre la OT-000011, no una lista con todo lo que contenga «11». Funciona con el número dicho en cifra o en letra, y distingue series: «orden de compra 5» es una compra.",
      "También llegan las pantallas que viven detrás de un botón, no solo las del menú: «abre kardex» abre el kardex, no el almacén donde vive. Igual con conteos cíclicos, traspasos, equivalencias, análisis e indicadores de almacén, el levantamiento, la cobertura de planes y una orden nueva.",
      "Nunca lleva a una pantalla que su perfil no puede abrir, y si no entiende le enseña lo que oyó —que casi siempre explica el problema solo— y ejemplos de lo que sí puede decir.",
    ],
    botones: [
      { nombre: "Micrófono (arriba, junto a la búsqueda)", explica: "Háblele al sistema: lo lleva a donde pida o le contesta hablando lo que pregunte. Un tono avisa cuándo empezar, se corta solo cuando usted termina de hablar, y sigue escuchando hasta que lo cierre. Sirve para pantallas («el almacén», «compras»), para filtros («mis órdenes», «las vencidas») y para buscar un equipo o un folio. Si lo que dice coincide con varias cosas, abre la búsqueda para que usted elija en vez de adivinar." },
    ],
    noPuedo: [
      { sintoma: "Se cortó antes de que yo terminara", porque: "Hizo una pausa larga y lo tomó por el final. Vuelva a tocar el micrófono: en el dictado, lo nuevo se agrega a lo anterior y no se pierde nada." },
      { sintoma: "No veo el micrófono en la barra de arriba", porque: "El navegador no puede grabar, o el plan no incluye los comandos de voz. La búsqueda y el menú hacen lo mismo escribiendo." },
      { sintoma: "Dije una pantalla y me contesta que no está disponible para mi perfil", porque: "Es correcto: la voz no abre nada que su rol no pueda ver. Es la misma regla del menú." },
      { sintoma: "Me llevó a la búsqueda en vez de al equipo que dije", porque: "Lo que dijo coincide con más de un registro. Preferimos que usted elija a llevarlo al equivocado sin que se note." },
      { sintoma: "Me volvió a pedir permiso del micrófono", porque: "Lo suelta cuando pasan 25 segundos sin usarlo, cuando usted lo cierra, o cuando lo abre y no habla nadie —eso es lo que apaga el indicador de grabación del teléfono—. Encadenar «llévame a…» con una pregunta NO vuelve a pedirlo. Para que Safari deje de preguntar del todo, instale MainTrack en la pantalla de inicio: Compartir → Agregar a inicio." },
      { sintoma: "Me contesta escrito pero no lo oigo", porque: "Este aparato no dejó reproducir el audio, o su plan no incluye la voz. Se le avisa dentro de la misma respuesta, y lo escrito está completo." },
    ],
  },

  "/vigencias": {
    titulo: "Garantías y vigencias",
    que: "Los papeles que se vencen y que alguien tiene que renovar a tiempo: garantías de equipo, pólizas de seguro, fianzas, contratos de servicio, calibraciones de instrumentos, permisos de operación, licencias del personal y certificados. Lo que en casi toda planta vive en una carpeta o en un Excel que solo una persona sabe abrir.",
    hacer: [
      "Registrar un documento con su vigencia y a quién se le reclama",
      "Ver de un golpe qué está vencido y qué se vence pronto",
      "Anotar qué cubre y qué no, para cuando llegue la falla",
      "Cancelar uno que dejó de aplicar, sin borrar la historia",
    ],
    flujo: [
      "Todo cuelga de algo: un equipo, una refacción, una persona o un servicio externo. De una sola cosa, y es a propósito: una vigencia que no aparece en ningún expediente está viva y nadie la ve, y una que aparece en dos deja la duda de cuál manda al renovar. Si una póliza cubre cinco equipos, se registra una por equipo.",
      "El tipo decide de qué puede colgar. Una licencia de montacargas es de una persona y una calibración es de un instrumento; ofrecer siempre las cuatro opciones invitaba a colgar la póliza del seguro de un usuario.",
      "Cada tipo avisa con su propia anticipación, y no es un detalle: una póliza avisa con 60 días porque hay que cotizar, y una calibración con 30 porque se agenda con el laboratorio. Poner el mismo plazo a todo era garantizar que la mitad avisara tarde y la otra demasiado pronto.",
      "El aviso se cierra solo cuando se registra otra vigencia DEL MISMO TIPO, sobre lo mismo, que cubra más lejos. Así se renueva de verdad: la póliza vieja se queda como historia de la planta y se carga la nueva. No hay que ir a apagar el aviso a mano.",
      "La GARANTÍA hace algo más que avisar: cuando alguien abre una orden correctiva, de seguridad o de mejora de un equipo que todavía está cubierto, se le dice antes de guardarla, y al responsable del trabajo le llega un aviso. Es el momento en que el dato vale dinero — repararlo con gente y refacciones propias es pagar lo que el proveedor ya cubrió, y en algunos contratos abrirlo sin avisar cancela la garantía.",
      "No se avisa en preventivo. Un engrasado programado no se le reclama al proveedor, y avisar ahí habría convertido la advertencia en ruido que se aprende a ignorar — y entonces no sirve el día que importa.",
      "La fecha de garantía que ya estaba en la ficha del equipo sigue ahí y sigue funcionando: ahora es un reflejo de la vigencia. La verdad es el documento, que además dice a quién reclamarle y qué cubre.",
      "Nada se borra. Una póliza cancelada antes de vencer se apaga y se conserva: borrarla dejaría sin explicación los avisos que ya salieron.",
      "Un documento sin fecha de vencimiento es válido y no avisa nunca. Un certificado de fábrica no se renueva.",
      "Tres descuidos que cuestan: registrar una garantía sin decir a quién se le reclama —el aviso llega y nadie sabe con quién renovar—; capturar una póliza que cubre cinco equipos como un solo documento; y suponer que mover la fecha de la vieja es renovar. Se puede, pero lo que el sistema reconoce como renovación es que exista la nueva.",
    ],
    botones: [
      { nombre: "Registrar documento", explica: "Da de alta una garantía, póliza, fianza, contrato, calibración, permiso, licencia o certificado. Pregunta de qué cuelga, desde y hasta cuándo, y a quién se le reclama." },
      { nombre: "Cancelar (la ✕ de cada renglón)", explica: "Lo apaga sin borrarlo: deja de avisar y se queda en la lista como cancelado. Se puede reactivar." },
    ],
    campos: [
      { nombre: "Cómo le llaman", explica: "El nombre con el que su gente lo pide: «Garantía de fábrica», «Póliza GNP 44812». No es el tipo: el tipo ya está aparte." },
      { nombre: "Qué cubre y qué no", explica: "Lo que alguien va a leer el día que llegue la falla, con el equipo parado y el proveedor al teléfono. Vale más que el folio: «cubre motor y tarjeta, no cubre consumibles ni daño por sobretensión»." },
      { nombre: "¿A quién se le reclama?", explica: "El proveedor, la aseguradora o el laboratorio. Es lo que convierte el aviso en una llamada: sin esto, quien lo recibe sabe que se vence y no a quién marcarle." },
      { nombre: "Hasta", explica: "La fecha de vencimiento. Vacía significa que no caduca, y entonces no avisa." },
    ],
  },
  "/rondines": {
    titulo: "Rondines",
    que: "El recorrido por la planta: lo que se ve, dónde y cuándo. Lo que hoy se queda en el pasillo o en una libreta que nadie vuelve a leer.",
    hacer: [
      "Empezar un recorrido, diciendo qué área va a caminar",
      "Anotar cada parada dictando lo que ve",
      "Escanear el código del punto, si lo tiene",
      "Decir de qué equipo era cuando el sistema no lo puede saber solo",
    ],
    flujo: [
      "Se empieza eligiendo el área. No es un trámite: es lo que después permite saber de qué equipo habla aunque no haya códigos pegados. Dentro de la línea 2, «la bomba 3» es una sola; en toda la planta pueden ser cuatro.",
      "En cada parada se dicta lo que se ve. El equipo se resuelve después, y muchas veces solo.",
      "Las fotos se toman antes de anotar la parada —se ve algo, se fotografía y se cuenta— y se suben cuando la parada queda guardada. Si alguna no sube por falta de señal, la parada se guarda igual y la foto queda con su botón de reintentar: no hay que volver a caminar el pasillo.",
      "También se pueden agregar fotos después, desde el detalle del recorrido. En el rondín no siempre da tiempo.",
      "De qué equipo se trata se busca en este orden: el código QR del punto, el equipo que usted elija, lo que se dictó, y el área. Solo cuando ninguno alcanza se le pregunta.",
      "Cuando se le pregunta, no viene nada marcado: hay que elegir. Es a propósito — una respuesta ya puesta se acepta sin leerla.",
      "«Ninguno: no es de un equipo en particular» es una respuesta válida y a veces la correcta. Un charco en un pasillo no es de ninguna máquina, y atribuírselo a la de al lado ensucia el historial de esa máquina para siempre.",
      "Si el recorrido se interrumpe —se bloquea el teléfono, se cae la señal— al volver a entrar se continúa el mismo, no se abre otro.",
      "Un recorrido sin ninguna parada se cancela solo: no hubo recorrido que guardar.",
      "Con el complemento de IA, las fotos del recorrido se pueden revisar: señala fugas, guardas faltantes, pasillos obstruidos y deterioro. Propone; no crea nada. Usted acepta lo que vale —y eso levanta una solicitud— o lo descarta.",
      "Cada hallazgo dice EN QUÉ SE BASA: «mancha oscura de unos 40 cm bajo la brida derecha». Eso es lo que le permite abrir la foto y decir que no. Si solo dijera «hay una fuga», no habría cómo contradecirlo.",
      "Lo que no se ve en una foto no se dice: vibración, ruido, temperatura o el estado interno de una máquina no salen en una imagen. Y una lista vacía es una respuesta correcta: significa que el área se ve bien.",
      "Volver a revisar reemplaza las propuestas pendientes, pero respeta lo que usted ya aceptó o descartó: eso es una decisión suya y no se borra por volver a preguntarle a la máquina.",
      "En cada parada queda registrado CÓMO se supo de qué equipo era. Una identificada por su código vale distinto que una deducida de lo que se oyó, y quien lo lea un mes después tiene derecho a saberlo.",
      "Abajo hay COMPROMISOS: lo que se acordó y no es una orden de trabajo —avisarle a producción, conseguir un equivalente, pedir una cotización—. Llevan responsable y fecha, y a quien le toca le llega un aviso que se cierra solo al marcarlo hecho.",
    ],
    botones: [
      { nombre: "Empezar recorrido", explica: "Abre un recorrido nuevo. Si ya tenía uno a medias, lo continúa en vez de abrir otro." },
      { nombre: "Dictar", explica: "Graba lo que usted dice y lo escribe en la observación de la parada. Se corta solo al terminar de hablar, y aguanta las pausas de quien se acuerda de algo a media frase. Pensado para el piso, con las manos ocupadas." },
      { nombre: "Escanear punto", explica: "Lee el código QR del punto de reporte. Es la forma más confiable de saber dónde está: no se equivoca nunca." },
      { nombre: "Anotar parada", explica: "Guarda lo que vio. Si hace falta saber de qué equipo era, se le pregunta enseguida." },
      { nombre: "Tomar foto / Elegir archivo", explica: "Agrega fotos a la parada. Se ven antes de subirlas y se puede quitar la que salió mal. Se suben al anotar la parada." },
      { nombre: "Revisar las fotos", explica: "Mira las fotos del recorrido y propone lo que un jefe de mantenimiento notaría al pasar. No crea nada: cada propuesta se acepta o se descarta." },
      { nombre: "Levantar solicitud (en un hallazgo)", explica: "Convierte el hallazgo en una solicitud de servicio, con la foto y en qué se basó. De ahí sigue el camino normal: alguien la revisa y decide si se vuelve orden." },
      { nombre: "No es (en un hallazgo)", explica: "Lo descarta. Queda registrado como descartado, no se borra: si siempre se descarta lo mismo, conviene saberlo." },
      { nombre: "Terminar", explica: "Cierra el recorrido. Lo que anotó queda para comparar con el siguiente." },
    ],
    noPuedo: [
      { sintoma: "No me deja anotar paradas, solo ver", porque: "Registrar un recorrido pide el mismo permiso que ejecutar trabajo. Consulta entra a mirar." },
      { sintoma: "Escaneé el código y no lo reconoce", porque: "El punto no existe, está dado de baja, o el código es de otra empresa. Puede anotar la parada dictando y decir de qué equipo era." },
      { sintoma: "Me pregunta de qué equipo es y yo no sé", porque: "Elija «Ninguno». Un hallazgo sin equipo sirve igual para que alguien vaya a verlo, y es mejor que atribuírselo al equipo equivocado." },
      { sintoma: "Revisó las fotos y no encontró nada", porque: "Puede ser que el área se vea bien, y entonces es la respuesta correcta. También puede que las fotos no alcancen a mostrarlo: revise si dice que alguna no sirve, y en el próximo recorrido acérquese o alumbre mejor." },
      { sintoma: "Propuso algo que claramente no es", porque: "Para eso está «No es». Mire la línea de «en la foto se ve»: si lo que describe no está ahí, descártelo sin dudar. La máquina propone, usted decide." },
      { sintoma: "No veo el botón de revisar las fotos", porque: "Revisar fotos con IA va con el complemento IA Avanzada. El recorrido, las paradas y las fotos funcionan igual sin él." },
      { sintoma: "Una foto se quedó en rojo y no subió", porque: "Se cayó la señal a media nave. La parada sí se guardó. Toque «Reintentar las fotos» cuando tenga señal, o agréguela después desde el detalle del recorrido." },
      { sintoma: "No aparece mi recorrido en la lista", porque: "Los que se cerraron sin ninguna parada se cancelan y no se listan." },
    ],
    preguntas: [
      { pregunta: "¿Para qué sirve hacer rondines si ya los hago a ojo?", respuesta: "Para poder comparar. Un recorrido suelto vale poco; dos del mismo punto separados por un mes contestan la pregunta que hoy nadie puede contestar: si aquella mancha creció, si la corrosión avanzó, si lo que se reportó se atendió." },
      { pregunta: "¿Y si la planta no tiene códigos QR pegados?", respuesta: "Se puede recorrer igual: basta decir el área al empezar y dictar lo que ve. Los códigos se imprimen desde «Puntos de reporte QR» cuando quiera, y a partir de ahí cada parada es de un toque." },
    ],
  },

  "/escanear": {
    titulo: "Escanear QR",
    que: "Leer con la cámara el código QR de un equipo, de un punto de reporte o de una orden, y abrir lo que corresponde con su usuario.",
    hacer: ["Tocar «Abrir cámara y escanear» y apuntar al código", "Escribir la clave del equipo o un folio si no hay cámara o el código está dañado"],
    flujo: [
      "La cámara se pide solo al tocar el botón (nunca al entrar) y se apaga al leer o al cancelar. Se usa la trasera.",
      "Funciona en Android y en iPhone: donde el navegador no trae lector, MainTrack lee el código por su cuenta.",
      "Lo leído se valida: tiene que ser de MainTrack y de su empresa. El QR de un equipo abre la ficha del equipo (órdenes abiertas, planes, lecturas, historial) a quien la puede ver; quien solo reporta llega al reporte con su usuario.",
      "Si el código no sirve, se dice por qué y se puede escanear otro o escribirlo.",
      "Sin sesión, el mismo QR es el reporte público de siempre, que no muestra datos internos.",
    ],
  },

  "/soporte": {
    titulo: "Soporte",
    que: "Pedir ayuda al equipo de MainTrack y ver en qué va. Es el canal de soporte: no hace falta correo ni teléfono.",
    hacer: ["Escribir qué intentaba hacer y qué pasó, elegir la severidad y enviar", "Ver el folio, el estado y la respuesta", "Agregar información, subir la severidad si urge más o confirmar que quedó resuelto"],
    flujo: [
      "Horario: lunes a viernes de 9:00 a 18:00, hora del centro de México, días hábiles. Los tiempos objetivo son de respuesta, no de solución, y dependen de la severidad y del plan (la tabla está en la misma pantalla).",
      "Severidad: Crítica si nadie puede usar MainTrack o hay riesgo de perder datos; Alta si una función principal no sirve y no hay forma de rodearlo; Media si hay forma de seguir; Baja para dudas y sugerencias.",
      "Los datos técnicos (navegador, pantalla, idioma, conexión y hora) se adjuntan solo si deja la casilla marcada; no incluyen contraseñas ni datos de su operación.",
      "Cada quien ve sus solicitudes; la administración ve las de toda la empresa. Cuando hay respuesta, llega un aviso a la campana.",
      "Si no puede entrar a MainTrack, su administrador lo reporta desde otra cuenta de la empresa.",
    ],
  },

  "/demo/presentacion": {
    titulo: "Presentación",
    que: "La presentación al cliente en diapositivas, a pantalla completa: el problema, qué es y qué no es MainTrack, los cinco casos sobre esta empresa, la inteligencia artificial, cómo se arranca, los precios y el cierre.",
    hacer: ["Avanzar y retroceder con las flechas del teclado, o con los botones de abajo", "Saltar a cualquier diapositiva desde el índice", "Abrir la pantalla real desde los botones de cada caso y regresar con «Atrás»", "Salir con Escape"],
    flujo: [
      "Una diapositiva a la vez y sin menú: lo que se proyecta es solo el tema del que se está hablando.",
      "Los textos, los precios y los límites salen de la misma fuente que el sitio comercial, así que nunca dicen algo distinto de lo que el cliente ya leyó.",
      "Los botones «abrir en el sistema» llevan a la pantalla real de la empresa demostrativa. Para volver, la banda morada de arriba ofrece «Volver a la presentación» con el nombre del caso, y regresa a la misma diapositiva; el «Atrás» del navegador también sirve. El ofrecimiento desaparece al salir de la presentación.",
      "Cada diapositiva de caso indica con qué cuenta conviene estar dentro, y trae una nota para quien presenta que no se proyecta hasta abrirla.",
    ],
  },

  "/demo": {
    titulo: "Guía de la demostración",
    que: "Solo existe en la empresa demostrativa: la presentación al cliente, cinco historias sobre el sistema real y cómo dejar la demo como nueva.",
    hacer: ["Iniciar la presentación en diapositivas", "Presentar un caso suelto desde su historia", "Seguir el orden recomendado para una demostración de 20 a 30 minutos", "Abrir los registros que usa cada historia", "Reiniciar el recorrido guiado", "Restaurar la demo al terminar (dirección o gerencia)"],
    flujo: [
      "Cada historia dice con qué rol se muestra, cuánto tarda, el problema, los pasos y el resultado que se explica.",
      "Todo lo que se captura durante la demostración funciona igual que en una cuenta real. Restaurar lo borra y vuelve a sembrar la historia de 90 días con fechas al día; se conservan la empresa y las cuentas.",
      "Mientras se restaura, la demo muestra «se está restaurando» y no atiende a nadie; tarda menos de un minuto. La operación queda en la auditoría.",
      "En la demo no se puede cambiar el plan, crear credenciales de API ni conectar avisos a otros sistemas, y nunca genera cargos.",
    ],
  },

  "/clients/prospectos": {
    titulo: "Prospectos",
    que: "Las solicitudes de demostración y de contratación que llegan del sitio, para darles seguimiento. Solo para el operador.",
    hacer: ["Cambiar el estado: contactada, demostración agendada o realizada, propuesta, ganada, perdida", "Anotar el resultado o el motivo de la pérdida", "Dar de alta la empresa en Empresas cliente cuando se gana"],
    flujo: [
      "Llegan con origen y fecha; una solicitud repetida por la misma persona el mismo día no se duplica.",
      "Arriba se ve cuántas son nuevas, cuántas demostraciones se hicieron, la tasa de las ganadas y los motivos de pérdida.",
      "No es un CRM: si se usa otro, esta lista sirve de entrada y se lleva allá.",
    ],
  },

  "/clients/soporte": {
    titulo: "Soporte a clientes",
    que: "Las solicitudes de soporte de todas las empresas, abiertas primero y por severidad. Solo para el operador.",
    hacer: ["Responder y cambiar el estado: en revisión, esperando al cliente, resuelta o cerrada", "Revisar los datos técnicos que el cliente adjuntó"],
    flujo: [
      "Cada cambio le llega a quien lo pidió en su campana. La primera respuesta queda registrada para medir el tiempo contra el objetivo del plan.",
      "Una solicitud resuelta se cierra cuando el cliente lo confirma; si no responde en 5 días hábiles, ciérrela usted.",
    ],
  },

  "/clients": {
    titulo: "Empresas cliente",
    que: "Las cuentas que opera desde esta plataforma. Solo para el operador.",
    hacer: ["Dar de alta una empresa eligiendo cómo empieza: vacía, con configuración recomendada o con datos de demostración", "Entrar a su cuenta para dar soporte o hacer la implementación", "Ver su avance y su estado operativo", "Vigilar los procesos que corren solos y las entregas de avisos de todas las empresas"],
    flujo: [
      "Estado comercial y estado operativo son dos cosas. El comercial —en prueba, activa, suspendida— lo decide usted. El operativo —en configuración, lista para operar, operando— sale de la puesta en marcha y nunca cambia el comercial.",
      "Al dar de alta se explica qué trae cada opción antes de crear. Vacía: la empresa, su responsable y los catálogos técnicos indispensables. Recomendada: además, los catálogos de su giro, su primer sitio y el almacén. Demostración: además, un juego chico marcado «[DEMO]». Ninguna inventa órdenes ni indicadores.",
      "Al entrar a una cuenta se ve un aviso permanente arriba, y todo lo que haga queda en la bitácora de esa empresa.",
      "El acceso se revalida en cada petición: si se retira el privilegio, la sesión deja de servir de inmediato.",
      "«Procesos programados» dice cuándo corrió por última vez cada tarea automática. «Callado» significa que lleva más de tres periodos sin terminar: un proceso detenido calla igual que uno sano, y esta tabla es la única forma de notar la diferencia sin abrir los registros del servidor.",
    ],
  },

  "/dashboard": {
    titulo: "Inicio",
    que: "Lo que usted tiene que ver primero, según su rol: el dueño, el estado de la empresa; supervisión, el trabajo del día; el técnico, sus órdenes; compras, requisiciones y entregas; quien reporta, sus reportes.",
    hacer: [
      "Escuchar el parte del día antes de entrar a la planta, o en el camino",
      "Usar las acciones rápidas de arriba para lo que hace todos los días",
      "Entrar directo a cada pendiente desde su renglón",
      "Ver de un vistazo cómo está cada área o sistema de la planta, y entrar a la que trae problema",
      "Ver los resultados del periodo (dueño)",
      "Actualizar los indicadores al momento, si acaba de cerrar trabajo",
    ],
    flujo: [
      "Cada rol ve un inicio distinto. No es una pantalla por rol: son los mismos registros, ordenados para lo que cada quien hace.",
      "Un registro aparece una vez, en el primer bloque que le toca: una orden crítica y vencida sale en «críticas», no repetida en «vencidas».",
      "Los colores siempre van con palabras («Urgente», «Revisar», «Al día»): se leen igual con el sol de frente o sin distinguir colores.",
      "Si no hay nada pendiente, se dice «Todo al día» en vez de mostrar bloques vacíos.",
      "En dirección y administración, el cumplimiento, la disponibilidad, el costo y los problemas de captura se calculan cada 15 minutos y abajo del resumen dice de cuándo son; con «Actualizar» se recalculan al momento. Son ventanas de 30 días: cerrar una orden mueve esas cifras décimas. Todo lo demás del inicio —vencidas, críticas, refacciones agotadas, compras por firmar— es de este instante.",
      "Los números salen de las órdenes y del almacén; no se capturan en ningún lado. En «Resultados», cada tarjeta de indicador abre su fórmula y los registros que la forman.",
      "Quien ejecuta no ve costos: mano de obra, refacciones y valor de equipos los ven la administración, supervisión y consulta.",
      "«Cómo está la planta» agrupa por sistema cuando la empresa tiene sistemas armados en el mapa de sistemas, y por área cuando todavía no. Un cuadro por equipo, hasta veinte; con más equipos los cuadros se reparten, pero un estado con al menos un equipo nunca desaparece de la barra.",
      "Cada renglón dice siempre las dos cosas —cómo están sus equipos y qué trae pendiente— para que los renglones se puedan sumar. Las órdenes vencidas que no cuelgan de ningún equipo no caben en ningún área y se cuentan aparte, al pie.",
      "Los equipos dados de baja no cuentan en ningún lado de esa franja. Quien no ve activos —compras y quien solo reporta— tampoco ve la franja.",
      "«El parte del día» dice, en menos de un minuto, lo que está fuera de servicio, las órdenes vencidas, las alertas sin atender, lo que espera su firma y las refacciones críticas agotadas. Va de lo más urgente a lo menos, y si no hay nada lo dice también.",
      "Las cifras del parte NO las escribe la inteligencia artificial: las calcula el sistema y la IA solo las acomoda para que se oigan como una persona hablando. Al recibir la redacción se revisa número por número, y si aparece alguno que no estaba en los datos, se descarta toda la redacción y se lee la versión del sistema. Sin el complemento de IA el parte funciona igual, solo que más plano.",
      "La voz se genera en el servidor y se guarda: la primera vez tarda unos segundos, y de ahí en adelante suena al instante sin volver a costar. Si no se puede generar —sin señal, o una falla— se usa la voz del propio aparato, que suena metálica pero dice exactamente lo mismo: más vale un parte feo que ningún parte.",
      "Cada quien escoge con qué voz lo escucha, en Ajustes → Apariencia. Hay doce y se pueden probar antes de elegir, porque los nombres no dicen cómo suenan. La voz es de cada persona, no de la empresa.",
      "El mismo parte queda escrito abajo del botón, porque escuchando no hay forma de comprobar una cifra.",
      "El parte no modifica nada, a propósito: se piensa para oírlo en el camino, y dictar un cierre de orden manejando es capturar mal un dato que después nadie puede explicar.",
    ],
    botones: [
      { nombre: "Escuchar", explica: "Arma el parte del día y lo lee en voz alta. Vuelto a tocar, lo detiene. El texto queda en pantalla aunque no se escuche." },
    ],
  },

  "/equipo": {
    titulo: "Personal de mantenimiento",
    que: "Cómo está repartido el trabajo, en qué se va el tiempo y qué está trabando la operación.",
    hacer: [
      "Ver qué trae asignado cada quien y su carga de los próximos 15 días",
      "Comparar el tiempo estimado contra el realmente aplicado",
      "Ver en qué equipos trabaja cada persona",
      "Pedirle a la IA que revise cómo está trabajando el equipo",
    ],
    flujo: [
      "El propósito es entender la operación a través de las personas, no evaluar a las personas. Por eso aquí no hay calificaciones ni listas ordenadas por productividad.",
      "Cada quien ve lo suyo. Supervisores y arriba ven al equipo completo.",
      "Los indicadores que no tienen suficientes casos aparecen en blanco a propósito: un porcentaje sacado de dos órdenes no dice nada de nadie.",
      "El periodo son los últimos 90 días, igual que los demás indicadores.",
    ],
    campos: [
      { nombre: "Comprometidas", explica: "Las horas estimadas de lo que trae abierto. Es lo que debe, no lo que ha hecho." },
      { nombre: "Aplicadas", explica: "Las horas que de verdad capturó en el periodo. La diferencia con lo comprometido no es buena ni mala por sí sola: depende de qué tan bien esté estimado el trabajo." },
      { nombre: "Barras de los 15 días", explica: "Su carga por día. En ámbar cuando ese día no le cabe lo asignado; en gris los días no laborables." },
      { nombre: "Estimado contra real", explica: "Solo se calcula sobre órdenes donde esa persona fue la única que capturó horas. Si dos trabajaron la misma orden, el estimado es del trabajo completo y repartirlo sería inventar." },
      { nombre: "% correctivo", explica: "Cuánto de su tiempo se fue en fallas. Arriba de 70% significa que está apagando incendios más que haciendo mantenimiento, y eso es un dato de la operación, no de la persona." },
    ],
    noPuedo: [
      { sintoma: "Un indicador aparece vacío", porque: "No hay suficientes casos para calcularlo. Se deja en blanco a propósito en vez de mostrar un número que engañaría." },
      { sintoma: "No veo a mis compañeros", porque: "Solo supervisores y arriba ven al equipo completo. Cada técnico ve sus propios números." },
      { sintoma: "Alguien tiene muchas horas comprometidas y pocas aplicadas", porque: "Puede ser que no esté capturando sus horas, o que el trabajo apenas vaya empezando. Revise sus órdenes antes de sacar conclusiones." },
    ],
    preguntas: [
      {
        pregunta: "¿Esto sirve para evaluar a mi personal?",
        respuesta:
          "No está hecho para eso, y usarlo así lo echa a perder. El día que la gente sienta que las horas que captura se usan para calificarla, empieza a inflarlas, y ahí se muere el dato y todo lo que depende de él. Sirve para entender la operación: dónde está mal repartido el trabajo, qué estimaciones no sirven, y qué trabas vienen de almacén y no de las personas.",
      },
      {
        pregunta: "¿Por qué la IA no me dice quién es el mejor técnico?",
        respuesta:
          "Porque ese número no existe y fabricarlo sería mentirle. El mismo dato admite varias explicaciones: alguien que tarda más puede estar recibiendo siempre los equipos peores, o trabajando con estimaciones mal hechas. Distinguir entre esas lecturas es lo que la IA sí puede hacer, y es más útil que un ranking.",
      },
      {
        pregunta: "¿Por qué las órdenes compartidas no cuentan para el estimado contra real?",
        respuesta:
          "Porque el tiempo estimado es del trabajo completo, no de cada persona. Si dos técnicos trabajaron la misma orden, repartir ese estimado entre ellos sería inventar un dato. Se dice con cuántas órdenes se calculó justamente para que se vea qué tan sólida es la cifra.",
      },
    ],
  },

  "/backlog": {
    titulo: "Trabajo pendiente",
    que: "Todo el trabajo que falta: órdenes abiertas y actividades que no se pudieron hacer, separadas por lo que les impide avanzar.",
    hacer: [
      "Ver de un vistazo cuántas órdenes están en espera, vencidas, sin responsable, sin programar o a tiempo, y cuántas actividades no se realizaron",
      "Leer por cada renglón su origen, activo, prioridad, horas estimadas, motivo, responsable, antigüedad y la próxima acción",
      "Ver qué quedó pendiente en cada equipo y por qué",
      "Saber cuáles ya se pueden hacer porque la refacción que faltaba ya llegó",
      "Ver cuánto lleva esperando cada actividad",
    ],
    flujo: [
      "Cada orden abierta cae en UNA categoría, la más urgente de resolver: en espera, vencida, sin responsable, sin programar o programada a tiempo. Si además le pasa otra cosa (vencida y sin responsable), aparece como aviso debajo del folio; no se cuenta dos veces.",
      "Una actividad suelta no se mezcla con una orden completa: las actividades no realizadas tienen su propia sección.",
      "Cuando una actividad de una orden no se puede hacer —no hay refacción, no hay quien, no se pudo parar el equipo— el técnico la libera indicando el motivo («Otro motivo» exige explicarlo).",
      "La actividad se queda marcada en su orden, para que esa orden cuente lo que de verdad pasó, y aparece aquí.",
      "Al armar una orden nueva para ese equipo, el trabajo pendiente se puede retomar.",
      "Si se liberó por falta de una refacción y se indicó cuál, esta pantalla marca «Ya se puede hacer» en cuanto hay existencia.",
      "Y no hay que estar asomándose: el sistema avisa solo. Cuando la refacción llega al almacén, le manda un aviso a quien liberó la actividad y a los supervisores, con el equipo y cuánto llevaba esperando.",
    ],
    campos: [
      { nombre: "Ya se puede hacer", explica: "Se liberó por falta de una refacción y hoy sí hay con qué: la original, o una equivalente registrada. Es la señal de que ese trabajo ya no tiene por qué seguir esperando." },
      { nombre: "Se puede resolver con…", explica: "La refacción original no llegó, pero hay una equivalente en existencia. Si es un sustituto, la salvedad viene ahí mismo: léala antes de mandar a montar la pieza." },
      { nombre: "Categorías", explica: "En espera: pausadas, con el motivo que se dio al pausar. Vencidas: abiertas con la fecha compromiso ya pasada. Sin responsable: nadie las tiene en su carga. Sin programar: sin fecha compromiso. Programadas a tiempo: con responsable y fecha por venir." },
      { nombre: "Horas", explica: "Las estimadas de la orden, o las de mano de obra del plan para una actividad. «Sin estimado» cuando no hay dato: no se inventa." },
      { nombre: "Próxima acción", explica: "Lo que destraba ese renglón: asignar, reprogramar con motivo, conseguir la refacción, coordinar el paro." },
      { nombre: "Origen", explica: "De dónde venía el trabajo. Una que viene de un plan es trabajo preventivo que se dejó de hacer, y eso importa más que un pendiente suelto." },
      { nombre: "Antigüedad", explica: "Días desde que se creó la orden, o desde que se liberó la actividad." },
      { nombre: "Liberada hace N días", explica: "Cuánto lleva esperando. Un número que crece sin parar es una refacción que nadie pidió o un servicio que nadie contrató." },
      { nombre: "El aviso automático", explica: "Sale una sola vez, en el momento en que la actividad pasa de no poderse a poderse. No se repite mientras siga disponible; si la refacción se vuelve a acabar y luego regresa, avisa de nuevo." },
    ],
    noPuedo: [
      { sintoma: "Una actividad no aparece aquí aunque no se hizo", porque: "Como actividad suelta solo entran las que se liberaron con motivo. Si su orden sigue abierta, la actividad va dentro de esa orden, que sí aparece en su categoría. Una orden ya no se puede completar con actividades sin resolver." },
      { sintoma: "Desapareció una que estaba aquí", porque: "Otra orden ya la retomó. Se puede seguir la cadena desde la orden nueva hasta la que la liberó." },
      { sintoma: "Dice «Ya se puede hacer» pero no me llegó ningún aviso", porque: "El aviso sale una sola vez, cuando cambia de estado. Si la refacción ya estaba antes de que se activara esta función, esa actividad no vuelve a avisar. También revise que tenga activados los avisos en Configuración → Avisos." },
      { sintoma: "Me llegó el aviso pero la refacción no es la que pedí", porque: "Se está resolviendo con una equivalente registrada. El aviso dice cuál. Si es un sustituto y no un equivalente exacto, revise la salvedad en la columna «Se puede resolver con…» antes de mandar a montarla." },
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

  "/work-orders/armar": {
    titulo: "Armar una orden",
    que: "Junta en una sola orden todo lo que se le debe a un equipo: el preventivo que ya toca, las fallas que le reportaron y lo que quedó trabado la vez pasada.",
    hacer: [
      "Elegir el equipo y ver los tres orígenes juntos",
      "Marcar actividad por actividad qué va en esta orden —lo que no marque queda para otra—",
      "Elegir qué tan adelante mirar: esta semana, este mes, los próximos 30 días",
      "Asignar responsable, fecha y prioridad",
    ],
    flujo: [
      "El técnico va a bajar a esa bomba de todos modos. Verlo todo junto antes de bajar evita hacer tres viajes por tres órdenes.",
      "Del plan se eligen ACTIVIDADES, no el plan entero. De cinco que caen la misma semana puede mandar tres en esta orden y dos en otra: con otro técnico, otro día de paro. Elegir una no arrastra a las demás.",
      "Lo ATRASADO —ya pasó su fecha y no está en ninguna orden— sale en rojo y primero, con cualquier ventana que elija.",
      "Una actividad que ya va en una orden abierta aparece tachada con el folio de esa orden. No se puede poner en dos órdenes a la vez; si alguien la tomó mientras usted armaba, el sistema lo detiene y le dice en cuál está.",
      "Se ofrecen también las que no han vencido, dentro de la ventana: si ya va a bajar, adelantar la que vence en cuatro días sale más barato que un segundo viaje.",
      "Cada actividad conserva de dónde vino y su propio tipo. Por eso al cerrar se pide la causa solo de las correctivas, y el paro de un correctivo colado en un preventivo se cuenta como no planeado.",
      "Los reportes que marque quedan ligados a la orden y se dan por atendidos.",
    ],
    botones: [
      { nombre: "Crear la orden", explica: "Arma la orden con lo marcado. El título se sugiere solo con lo que eligió, y se puede cambiar." },
    ],
    noPuedo: [
      { sintoma: "No veo esta pantalla", porque: "Armar órdenes requiere perfil de supervisor o superior." },
      { sintoma: "El equipo no tiene nada que ofrecer", porque: "Nada de su plan cae dentro de la ventana elegida, y no tiene fallas reportadas ni pendientes. Pruebe con una ventana más amplia. Si no tiene plan asignado, vaya a Planes → Equipos y sus planes." },
      { sintoma: "Una actividad aparece tachada y sin casilla", porque: "Ya va en otra orden abierta —el folio está a la derecha—. Cuando esa orden se cierre o la actividad se libere, vuelve a estar disponible." },
    ],
    preguntas: [
      { pregunta: "¿Por qué no aparece un plan que sí tiene el equipo?", respuesta: "Porque ninguna de sus actividades vence dentro de la ventana que eligió arriba. Amplíela a «este mes» o «próximos 30 días». La opción «la de la empresa» usa el plazo configurado en Configuración → Órdenes de trabajo. Adelantar de más gasta el mantenimiento antes de tiempo." },
      { pregunta: "Marqué tres de cinco. ¿Qué pasa con las otras dos?", respuesta: "Siguen disponibles para otra orden, con su propia fecha. Si esa fecha pasa sin que estén en ninguna orden, aparecen como atrasadas. Cada actividad avanza su calendario solo cuando se cierra la orden que la trae." },
      { pregunta: "¿Qué es «Marcar todas»?", respuesta: "Un atajo que marca de un jalón las actividades que el plan ofrece en esta ventana. Lo normal es elegir renglón por renglón." },
      { pregunta: "El plan aparece pero con menos actividades de las que tiene. ¿Se perdieron?", respuesta: "No. Cada actividad lleva su propia frecuencia, y solo se ofrecen las que tocan. La revisión semestral no aparece en la orden de esta semana porque no toca todavía: aparecerá cuando venza. Cada renglón muestra su vencimiento —vencida, vence hoy, en 6 días— para que usted decida si adelanta." },
      { pregunta: "Marco algo de un grupo y se borra lo de otro. ¿Por qué?", respuesta: "Porque su organización tiene apagada la opción de juntar varios orígenes en una orden: cada origen lleva su propia orden. Se cambia en Configuración → Órdenes de trabajo." },

      { pregunta: "¿En qué se diferencia de «Nueva orden»?", respuesta: "«Nueva orden» captura un trabajo suelto a mano. «Armar» parte de lo que el sistema ya sabe que se le debe a ese equipo y lo junta. Si solo va a levantar un correctivo que nadie reportó, use Nueva orden." },
      { pregunta: "¿Qué pasa con la actividad si la adelanto?", respuesta: "Su calendario en ESE equipo avanza al cerrar la orden, contado desde que se hizo o desde la fecha en que tocaba, según lo configurado. Las demás actividades del plan y los demás equipos siguen su propio calendario." },
    ],
  },
  "/work-orders": {
    titulo: "Órdenes de trabajo",
    camposBuscables: true,
    que: "Todo el trabajo de mantenimiento: lo que se planeó, lo que salió mal y lo que ya se hizo.",
    hacer: [
      "Crear una orden correctiva a mano",
      "Filtrar por estado, tipo, prioridad o responsable",
      "Acomodar columnas, agrupar hasta en tres niveles y guardar su vista",
      "Quitar horas, refacciones o servicios cargados por error, mientras la orden no esté cerrada",
    ],
    flujo: [
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Las preventivas las genera el programador desde los planes; no se capturan una por una.",
      "Las correctivas nacen de una solicitud, de una alerta predictiva o a mano.",
      "Una misma orden puede juntar trabajo de varios orígenes: el preventivo del mes de esa bomba, más la fuga que alguien reportó. Cada actividad conserva de dónde vino.",
      "El ciclo es Borrador → Abierta → Asignada → En proceso (con pausas En espera) → Completada → Cerrada, más Cancelada. Cada orden muestra solo las acciones válidas para su estado y para el rol de quien la ve.",
      "Completada significa que el técnico terminó el trabajo (cierre técnico). Cerrada significa que un supervisor validó horas, paro, refacciones, servicios, costos, diagnóstico, pendientes y evidencia (cierre administrativo).",
      "Lo que se cargó por error se puede quitar mientras la orden no esté cerrada: horas, refacciones y servicios traen su botón. Quitar una refacción NO borra el movimiento del almacén: genera una devolución que lo compensa, así que la pieza vuelve a estar disponible y el kardex sigue explicando a dónde se fue cada cosa. Un técnico quita las horas que él capturó; supervisión, las de cualquiera.",
      "Para iniciar, la orden necesita responsable: quien la inicia puede tomarla; un supervisor puede iniciarla sin responsable solo con motivo.",
      "Poner en espera, cancelar, devolver a proceso, reabrir y reactivar piden motivo. Todo cambio de estado queda en «Historial de estados» con quién, cuándo y por qué, y el motivo también se anota en la bitácora de la orden.",
      "La solución se puede dictar en vez de escribirla: el botón «Dictar» graba hasta un minuto, lo pasa a texto y lo agrega a lo que ya haya en el campo, sin borrarlo. Está pensado para el piso, con las manos ocupadas. Lo dictado se revisa y se corrige antes de completar: la transcripción se equivoca con códigos de refacción y con nombres propios.",
      "Al completarla se pide la solución aplicada; horas registradas (o por qué no hay); si requería paro, los minutos (o confirmar que no hubo paro); en fallas, código y causa raíz (o «Sin determinar» con justificación); todas las actividades hechas o enviadas al backlog, y evidencia solo si la empresa la exige para equipos críticos o de seguridad.",
      "Al cerrarlas, sus horas, refacciones y servicios alimentan el costo por equipo. Una orden cerrada ya no acepta horas, refacciones, servicios ni cambios de actividades: para corregirla, administración la reabre con motivo.",
      "Cambiar la fecha compromiso de una orden ya programada pide el motivo de la reprogramación. Si la fecha no es laborable o el responsable no tiene capacidad ese día, el sistema advierte, propone días y personas con lugar, y deja programarla así si usted lo confirma.",
      "En las preventivas, el plan ya dice qué refacciones se van a consumir: la requisición se arma con eso y descuenta lo que ya se pidió o se consumió.",
      "Al pedir, el sistema dice cuánto cubre el almacén y cuánto no, para poder empezar con lo que hay y mandar el resto a compras.",
      "Desde que la orden se INICIA, arriba aparece qué le falta para poder cerrarse: la solución, las horas, los minutos de paro, el diagnóstico, las actividades sin resolver y la evidencia, según lo que pida esa orden. Cada punto es una liga que lleva a la tarjeta donde se captura. Antes de iniciarla no se muestra —a una orden que nadie ha empezado no le «faltan» las horas— y cuando ya no falta nada, lo dice en verde.",
      "El índice está en los dos tamaños: en el teléfono como una tira arriba que se desliza de lado, y en escritorio de pie al costado, acompañando el desplazamiento. Es la misma lista y las mismas señas.",
      "Las secciones que no tocan en ese momento nacen recogidas, a un toque de abrirse: el procedimiento y la seguridad se leen antes de empezar y luego se recogen; la bitácora se abre sola cuando la orden está en espera, porque ahí está el motivo; las lecturas se ofrecen mientras el trabajo está en proceso. Una sección con algo pendiente SIEMPRE nace abierta, sin importar el estado: esconder lo que falta para cerrar sería peor que mostrar de más.",
      "El índice de secciones del teléfono no solo lleva: marca. En ámbar la sección que detiene el cierre, en verde la que ya está lista, y en gris las que no tienen noción de terminadas —la bitácora o las lecturas no «se acaban»—. Los colores van acompañados de un ícono, para quien no los distingue.",
      "En el teléfono, cada orden se lee en el orden del trabajo: qué es, dónde está el equipo, estado, prioridad y vencimiento; luego actividades, seguridad, tiempo, materiales, lecturas, evidencias y resultado, con un índice arriba para saltar a cada paso. Lo secundario (servicios, procedimiento, historial, datos completos) está plegado: se abre al tocarlo. Las acciones del paso siguiente quedan fijas abajo: aceptar, iniciar, pausar o reportar bloqueo, terminar y enviar a revisión, y pedir apoyo.",
      "«Aceptar» le dice a supervisión que usted ya vio la orden asignada y la va a atender, sin iniciarla todavía. Queda en la bitácora y aparece solo para el responsable, antes de iniciar.",
      "«Pausar o reportar bloqueo» deja la orden en espera con el motivo. Para pedir ayuda sin pausar, toque «Pedir apoyo»: lo lleva a la bitácora con la casilla «Pedir apoyo a supervisión» marcada; la nota queda en la orden y a supervisión le llega un aviso.",
      "Las fotos de evidencia se eligen, se ven y se pueden quitar antes de subirlas; se reducen para que suban por datos móviles sin perder lo que muestran. Si una falla, se reintenta sola esa.",
      "Un doble toque no registra dos veces el mismo consumo de refacción ni las mismas horas: la segunda se rechaza y se avisa que la primera sí quedó.",
      "Si otra persona cambió un dato de la orden mientras usted la editaba, no se pisa: se avisa qué cambió, se carga lo vigente y lo que usted escribió se queda en el formulario para revisarlo.",
      "La lista acepta ligas con filtros: «mis órdenes», vencidas, sin responsable, por estado o por prioridad. En el teléfono se ve como tarjetas; en computadora, como tabla.",
      "Quien ejecuta no ve costos en la orden ni en la lista: los ven la administración, supervisión y consulta.",
      "Abajo de todo hay una conversación pegada a este registro: lo que se hable ahí queda aquí para siempre, no en un chat suelto donde se pierde en veinte minutos. Mencione a alguien con el botón @ y le llega un aviso con el texto y la liga. Nombrarse a uno mismo no avisa. Cada quien puede borrar lo suyo, y queda marcado como eliminado en vez de dejar un hueco.",
      "Junto a la conversación están los COMPROMISOS: lo que se acordó y no es una orden de trabajo —cotizar con tres proveedores, hablar con seguridad, mandar el reporte—. Llevan responsable y fecha, y al responsable le llega un aviso que se cierra solo cuando el compromiso se marca hecho. Puede cerrarlo su responsable o quien lo anotó.",
      "Y el botón «Avísenme» de la conversación le manda a usted todo lo que pase con este registro, aunque no sea el responsable ni quien lo pidió. Es copia, no reemplazo: quien tenía que enterarse se sigue enterando.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la orden. Es como se le nombra en piso y en cualquier reporte." },
      { nombre: "Descripcion", explica: "El título del trabajo y, debajo, el activo al que se le hace. Sin activo, el costo después no se le puede atribuir a nada." },
      { nombre: "Tipo", explica: "Preventivo nace de un plan; correctivo de una falla; predictivo de una alerta. La mezcla entre ellos es el indicador de si el preventivo esta alcanzando." },
      { nombre: "Prioridad", explica: "Con que urgencia atenderla. No es lo mismo que la criticidad del equipo: un equipo critico puede tener un trabajo que aguanta." },
      { nombre: "Estado", explica: "En que etapa va. Solo las cerradas alimentan los costos y los indicadores." },
      { nombre: "Responsable", explica: "A quien esta asignada. «Sin responsable» en ámbar es una orden activa que nadie tiene en su carga de trabajo." },
      { nombre: "Vencimiento", explica: "Cuando debio estar hecha. En rojo cuando ya paso, con los días que lleva vencida; «Por vencer» cuando se acerca; «Sin programar» cuando no tiene fecha compromiso." },
      { nombre: "Horas real / est.", explica: "Lo que llevo contra lo que se estimo. Si la real supera a la estimada de forma consistente, el plan esta mal calibrado." },
      { nombre: "Costo total", explica: "Mano de obra mas refacciones mas servicios externos. Se llena solo conforme se carga cada cosa; en cero significa que aun no se registra nada." },
    ],
    botones: [
      { nombre: "Nueva orden", explica: "Da de alta una orden correctiva a mano. Las preventivas no se capturan aqui: las genera el programador." },
      { nombre: "Editar (dentro de la orden)", explica: "Cambia responsable, cuadrilla, tipo, prioridad, activo, fechas, horas estimadas, procedimiento y notas de seguridad. Al asignar responsable, una orden abierta pasa a «asignada» sola." },
      { nombre: "Generar requisición (en preventivas)", explica: "Arma la requisición sola con las refacciones que el plan pide y que todavía no se han pedido ni consumido. Solo hay que revisar, ajustar y enviar." },
      { nombre: "Pedir otra cosa", explica: "Requisición manual desde la misma orden, para lo que el técnico descubre que hace falta y no estaba en el plan." },
      { nombre: "Generar procedimiento (en correctivas)", explica: "Propone cómo asegurar el equipo, los pasos en orden, qué medir y contra qué, y qué refacciones del catálogo llevar. Al aplicarlo, los pasos se vuelven actividades que el técnico va palomeando." },
      { nombre: "Dictar (al completar la orden)", explica: "Graba lo que usted dice y lo escribe en «Solución aplicada». Se corta solo cuando usted termina, aguantando las pausas de quien piensa a media frase. Hasta un minuto por vez, y se puede dictar varias veces: cada una se agrega a lo anterior. Revise el texto antes de completar." },
      { nombre: "Codificar con IA (al completar la orden)", explica: "Lee lo que usted escribió o dictó y propone código de falla, causa raíz y las refacciones que sugiere cargar. Usted acepta o corrige; no se guarda nada por su cuenta." },
      { nombre: "Exportar CSV", explica: "Baja lo que esta viendo, con los filtros aplicados, para llevarlo a una hoja de cálculo." },
      { nombre: "Los cuatro desplegables de arriba", explica: "Filtran contra la base de datos, no solo lo que ve. Sirven para acotar antes de trabajar." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de nueva orden", porque: "Crear órdenes requiere perfil de supervisor o superior. Un técnico ejecuta, no da de alta." },
      { sintoma: "No me deja editar una orden", porque: "Está cerrada o cancelada. Su historial es el respaldo de lo que costó. Una cerrada la puede reabrir administración con motivo; una cancelada se reactiva." },
      { sintoma: "No me deja completar la orden", porque: "Le falta información esencial y el mensaje dice qué: solución, horas o su justificación, duración del paro o confirmar que no hubo, código y causa de la falla o su justificación, actividades sin resolver, o evidencia si la empresa la exige." },
      { sintoma: "No veo «Validar y cerrar»", porque: "Cerrar lo hace un supervisor, administrador o propietario. El técnico completa; la validación es de otra persona a propósito." },
      { sintoma: "No veo «Reabrir» en una orden cerrada", porque: "Reabrir una orden cerrada lo autoriza solo administración o el propietario, y pide motivo." },
      { sintoma: "No veo el botón de dictar", porque: "El navegador no puede grabar —pasa en navegadores viejos o sin permiso de micrófono para el sitio— o el plan no incluye el dictado. Escriba el texto y el resto funciona igual." },
      { sintoma: "Dicté y dice que no me entendió", porque: "Con una banda corriendo al lado el micrófono no alcanza. Acérquese el teléfono a la boca, o apártese del ruido. Ese intento no le descuenta nada." },
      { sintoma: "No me deja iniciar", porque: "La orden no tiene responsable. Elija «Tomarla yo» al iniciar, o pida que se la asignen." },
      { sintoma: "No me deja cancelar o pausar sin escribir nada", porque: "Esos pasos piden motivo: queda en el historial de la orden para quien la retome." },
      { sintoma: "Al guardar la fecha me pide un motivo", porque: "Mover la fecha compromiso de una orden ya programada es una reprogramación y se registra con su motivo." },
      { sintoma: "Al guardar me aparece «Revise la programación»", porque: "La fecha no es laborable o el responsable ya no tiene horas libres ese día. Elija uno de los días o personas propuestos, o marque «Programar así de todos modos»." },
    ],
    preguntas: [
      { pregunta: "¿Cómo sé cuánto material llevó cada actividad de la orden?", respuesta: "En la orden, el bloque «Material por actividad» muestra por cada tarea lo pedido, lo entregado, lo pendiente, lo que se mandó a comprar, lo devuelto y su costo neto. El material que se cargó a la orden completa aparece aparte, sin tipo." },
      { pregunta: "¿Puedo cambiar el orden en que se ejecutan las actividades?", respuesta: "Sí. Cada actividad trae flechas para subirla o bajarla un lugar. El plan y la IA proponen un orden; usted decide el definitivo, que para eso conoce la planta. Se mueve de a un lugar y no arrastrando, porque en tableta y con guantes arrastrar se presta a errores." },
      { pregunta: "¿Por qué no me deja mover una actividad?", respuesta: "Porque ya se resolvió, o porque quiere pasarla arriba de una que ya se hizo. Lo que ya ocurrió se queda donde ocurrió: moverlo diría que se ejecutó en un orden que no fue. Tampoco se reordena una orden cerrada." },
      { pregunta: "Un grupo aparece dos veces en la lista. ¿Está mal?", respuesta: "No. Los grupos son tramos: si usted decidió «tres pasos del plan, luego atender la fuga, luego el resto del plan», la pantalla muestra exactamente esa secuencia. Por eso la numeración siempre asciende y coincide con la hoja impresa." },

      { pregunta: "¿Qué son los grupos de colores en la lista de verificación?", respuesta: "Cada actividad conserva de dónde vino, y la lista las agrupa para que se distinga de un vistazo qué es rutina del plan preventivo, qué propuso la IA, qué salió de un reporte de falla y qué se retomó del trabajo pendiente. Cada grupo se puede plegar y trae su avance —«3 de 5»— para saber qué falta sin recorrer toda la lista." },
      { pregunta: "¿Por qué los grupos están en ese orden y no por urgencia?", respuesta: "Porque la lista se ejecuta de arriba abajo. Ordenarla por urgencia movería los pasos de seguridad de lugar: el bloqueo y etiquetado del equipo dejaría de ser el primero. Los grupos van en el orden en que están las actividades, y por eso la numeración coincide con la de la hoja impresa." },
      { pregunta: "El encabezado dice «Desde solicitud SS-000012». ¿Puedo ver ese reporte?", respuesta: "Sí, dele clic al folio y lo lleva directo al registro: quién lo reportó, cuándo, con qué detalle y con la foto si la subieron." },

      { pregunta: "¿Por qué no aparecen mis órdenes preventivas?", respuesta: "Las genera el programador desde los planes. Vaya a Planes preventivos y ejecútelo: ahí le dice, plan por plan, por qué generó o por qué no." },
      { pregunta: "¿Por qué al cerrar un preventivo no me pide código de falla?", respuesta: "Porque una rutina que se ejecutó bien no es una falla. El código de falla documenta un evento de falla, y ponérselo a un preventivo inventa una avería que nunca ocurrió: después aparece en el Pareto de modos de falla y en el cálculo de tiempo entre fallas, y le hace creer que ese equipo tiene un problema que no tiene. Si al hacer el preventivo el técnico SÍ encontró algo, eso se levanta como reporte de falla y se atiende como actividad correctiva —ahí sí se codifica." },
      { pregunta: "Mi orden trae el preventivo y dos fallas reportadas. ¿Cómo se cierra?", respuesta: "El cierre le pregunta la causa una vez por cada falla, no una sola vez para toda la orden. Son eventos distintos y cada uno conserva su código, su causa raíz y su tiempo de paro. Las actividades del plan no piden nada. El paro total del equipo es la suma de lo que causó cada falla, y se cuenta como paro no planeado aunque la orden haya nacido de un preventivo." },
      { pregunta: "¿De dónde saca el procedimiento de una correctiva?", respuesta: "Del equipo, de la falla reportada y —lo más valioso— de las reparaciones anteriores de ese mismo equipo. Lo que ya funcionó ahí vale más que un procedimiento de manual. Las refacciones que sugiere salen de su catálogo, con código: nunca inventa una que no existe." },
      { pregunta: "¿Cuál es la diferencia entre Completada y Cerrada?", respuesta: "Completada: el técnico terminó y capturó el cierre técnico. Cerrada: un supervisor revisó horas, paro, refacciones, servicios, costos, diagnóstico, pendientes y evidencia, y la validó. Si al revisar falta algo, la devuelve a proceso con motivo. Una vez cerrada, la orden no acepta cambios sensibles sin que administración la reabra." },
      { pregunta: "El trabajo lo hizo un contratista y no hay horas propias. ¿Cómo la completo?", respuesta: "Al completar, escriba por qué no hay horas —por ejemplo «lo hizo el proveedor; su costo va en servicios»— y cargue el servicio. Esa excepción justificada no cuenta como orden sin horas en la calidad de captura." },
      { pregunta: "¿Qué pasa si hago doble clic en Completar?", respuesta: "Nada extra. El cambio de estado se aplica una sola vez: el segundo clic encuentra la orden ya completada y no repite el paro, el avance del plan ni la notificación." },
      { pregunta: "¿Cómo cargo las refacciones que se usaron?", respuesta: "Dentro de la orden, en el panel de refacciones. Si el material salió por una requisición al almacén, el consumo ya quedó cargado solo." },
    ],
  },

  "/plans/cobertura": {
    titulo: "Equipos y sus planes",
    que: "Qué plan tiene cada equipo, y cuáles no tienen ninguno.",
    hacer: [
      "Ver de un vistazo qué equipos quedaron sin plan de mantenimiento",
      "Aplicar un plan a varios equipos de una vez",
      "Quitar un equipo de un plan",
      "Filtrar por categoría, sitio o buscar por clave",
      "Pedirle a la IA por dónde empezar cuando no hay ningún plan todavía",
    ],
    flujo: [
      "La pantalla mira desde el lado del EQUIPO, no del plan. Es a propósito: una planta puede tener compresores tipo A, B y C —todos en la categoría «Compresores»— y cada tipo lleva su propio plan. Qué equipo va a qué plan lo decide usted; el sistema no puede adivinarlo.",
      "Lo que el sistema sí garantiza es que se vea cuál equipo no está en ningún plan. Ese dato nunca se equivoca y es el que importa: un equipo sin preventivo es una falla que no avisa hasta que el equipo se para.",
      "Se eligen varios equipos con las casillas, se escoge el plan y se aplica. Las fechas se reparten solas para no parar todos el mismo día.",
      "Los equipos retirados no se reclaman: ya no necesitan preventivo.",
    ],
    campos: [
      { nombre: "Sin ningún plan", explica: "Ese equipo no está en ningún plan de mantenimiento. No significa que le falte «el plan A»: significa que no tiene ninguno." },
      { nombre: "Las etiquetas verdes", explica: "Los planes que ese equipo sí tiene, con su próxima fecha. Un equipo puede estar en varios planes —uno mensual y otro anual— y es normal." },
      { nombre: "Elegir todos los visibles", explica: "Marca los que el filtro está mostrando, no todo el catálogo. Filtre primero y elija después." },
    ],
    noPuedo: [
      { sintoma: "El sistema no me sugiere qué plan ponerle a un equipo", porque: "No puede saberlo sin equivocarse. Dos compresores de la misma categoría pueden llevar planes distintos si cambia una actividad o la frecuencia. Lo que sí hace es no dejar que un equipo se quede sin ninguno." },
      { sintoma: "Apliqué un plan por horas y avisa que falta el medidor", porque: "Ese plan vence según la lectura del equipo. Sin medidor dado de alta no va a generar órdenes. Déselo de alta desde el activo." },
    ],
    preguntas: [
      {
        pregunta: "¿Por qué no se asignan los planes automáticamente por categoría?",
        respuesta:
          "Porque sería un error. Si su planta tiene compresores tipo A, B y C —todos en la categoría «Compresores»— y cada tipo lleva su plan, asignar por categoría le pondría a los tipo A el plan de los tipo B. Aplicar un plan compromete trabajo con una fecha, y eso lo decide quien conoce los equipos.",
      },
      {
        pregunta: "¿Qué hace «Proponer un orden»?",
        respuesta:
          "Cuando hay muchos equipos sin plan, el problema es la hoja en blanco. La IA lee su catálogo —cuántos equipos por familia, cuáles son críticos y cuáles generan más correctivo— y propone en qué orden armar el programa y qué lleva típicamente cada familia. No crea nada: es el orden, no el plan. El plan lo redacta después el generador, desde un equipo representativo.",
      },
      {
        pregunta: "¿Un equipo puede tener varios planes?",
        respuesta:
          "Sí, y es lo normal: un preventivo mensual, una inspección trimestral y un servicio mayor anual. Cada uno lleva su propia fecha.",
      },
    ],
  },

  "/plans": {
    titulo: "Planes preventivos",
    camposBuscables: true,
    que: "Las rutinas que se repiten: qué se le hace a cada equipo, cada cuánto, con qué refacciones y cuánto cuesta.",
    hacer: [
      "Dar de alta un plan con sus actividades, refacciones, mano de obra y servicios",
      "Generarlo con IA a partir del equipo, o completar con IA lo que consume un plan que ya existe",
      "Ejecutar el programador para que nazcan las órdenes",
    ],
    flujo: [
      "Decir QUÉ CONSUME cada actividad no es un adorno del plan: es lo que después contesta qué hay que comprar y cuándo (Almacén › «Lo que va a pedir el preventivo»). Un plan sin eso genera órdenes correctas y deja al almacén adivinando.",
      "La mayoría de las actividades de un preventivo NO consumen material —revisar, medir, limpiar, probar no gastan nada— y dejarlas sin refacción es correcto. Lo que sí conviene revisar es un plan entero sin una sola refacción.",
      "Medido en producción, lo que faltaba no eran las refacciones del plan sino las del CATÁLOGO: los planes describen bien el trabajo y consumen cosas que el almacén no tiene dadas de alta —grasa EP-2 para un montacargas cuando solo hay grado alimenticio, por ejemplo—. Por eso la sugerencia distingue las tres: lo que consume del catálogo, lo que no consume nada, y lo que consume algo que hay que dar de alta.",
      "El nombre abre el expediente del plan: sus equipos con la próxima fecha y la última ejecución, sus actividades con recursos, las órdenes que ha generado y su cumplimiento. Editar se hace ahí mismo.",
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Un mismo plan se puede aplicar a varios equipos iguales. Diez compresores del mismo modelo llevan un solo plan, no diez: se define una vez y se aplica a todos con el botón «Equipos».",
      "Cada actividad lleva su fecha en CADA equipo. Al aplicar el plan todas arrancan con la fecha que se dé en común; las que en la realidad van distinto se corrigen en «Equipos → Fechas de sus actividades».",
      "Qué equipos van en cada plan lo decide usted: dos compresores de la misma categoría pueden llevar planes distintos si cambia una actividad o la frecuencia. Lo que el sistema sí vigila es que ningún equipo se quede sin plan, y lo avisa en «Equipos y sus planes».",
      "Cada equipo conserva su propia fecha. Al aplicar el plan, el sistema ofrece repartir las fechas para que no se paren todos el mismo día —los críticos primero— o ponerlas todas iguales si así conviene.",
      "Mejorar el plan una vez lo mejora para todos los equipos en su siguiente ciclo.",
      "Un plan no hace nada por sí solo: el programador es el que convierte planes en órdenes.",
      "Cada plan dispara con anticipación: si vence el día 5 y anticipa 3 días, la orden nace el día 2.",
      "Al cerrar la orden generada, el plan recalcula su próximo vencimiento.",
          "Cada actividad lleva su propia frecuencia y su propia unidad: cada 15 días, semanal, mensual, trimestral. En blanco toma la del plan, que es el caso de siempre. Así un solo plan cubre el aceite quincenal y el líquido de frenos semestral, sin partirlo en dos.",
      "Cada actividad tiene su propia fecha, contada desde la última vez que se hizo ESA actividad en ESE equipo. Al asignar el plan usted dice cuándo se hizo por última vez o desde cuándo arranca; después manda el historial. Si el aceite se cambió fuera de ciclo porque la máquina ya estaba abierta, solo ese calendario se recorre.",
      "«Mensual» no es lo mismo que «cada 30 días»: doce veces treinta días se corren cinco al año. Y si en Configuración → Órdenes de trabajo eligió contar en días hábiles, «cada 15 días» son 15 días de trabajo, saltando los que su empresa no labora. Eso aplica solo a los intervalos en días; un trimestre son tres meses siempre.",
      "Las actividades que caen cerca salen en UNA sola orden: el técnico va una vez y hace todo lo que toca. Qué tan cerca lo decide «cuánto se puede adelantar un preventivo», en Configuración. La ventana siempre adelanta, nunca retrasa: nada se difiere por acompañar a otra cosa.",
      "Abajo hay COMPROMISOS: lo que se acordó aquí y no es una orden de trabajo —cotizar con tres proveedores, revisar una frecuencia con producción, hablar con alguien—. Llevan responsable y fecha, y a quien le toca le llega un aviso que se cierra solo al marcarlo hecho.",
],
    tablaConfigurable: true,
    campos: [
      { nombre: "Confirmo que esta actividad es diaria", explica: "Aparece cuando una actividad va cada día. Una rutina diaria es válida —la revisión de arranque de turno— pero también es el error de captura más caro: 365 visitas al año. No se guarda sin confirmarla; se registra quién la confirmó y cuándo. Si después deja de ser diaria, la confirmación se retira sola y queda en la bitácora. Las diarias sin confirmar (por ejemplo, importadas) aparecen como advertencia en el índice de captura." },
      { nombre: "Equipos", explica: "A cuántos equipos se aplica este plan. Cuando es uno solo se muestra cuál; cuando son varios, lo que importa es cuántos." },
      { nombre: "Plan", explica: "El nombre con el que lo va a reconocer el tecnico. Debajo van sus referencias y manuales." },
      { nombre: "Activo", explica: "A que equipo se le aplica. Un plan sin activo NO genera ordenes: es el motivo mas comun de que el programador no haga nada." },
      { nombre: "Tipo", explica: "Preventivo, predictivo o inspeccion. Define el tipo con el que nacen sus ordenes." },
      { nombre: "Disparo", explica: "Calendario dispara por dias; medidor por lectura acumulada; condicion espera a que alguien lo decida." },
      { nombre: "Frecuencia", explica: "Cada cuanto toca. Ojo: manda el numero, no el nombre. Un plan llamado mensual con intervalo de 3 dias genera cada tres dias." },
      { nombre: "Proximo", explica: "Cuando vence. La orden nace antes, restando los días de anticipacion." },
      { nombre: "Actividades", explica: "Cuantos pasos trae la rutina. Cada uno puede llevar su mano de obra, sus refacciones y sus servicios." },
      { nombre: "Costo est.", explica: "Lo que cuesta ejecutarlo una vez, sumando todo. Multiplicado por la frecuencia es lo que cuesta al ano mantener ese equipo." },
      { nombre: "OT generadas", explica: "Cuantas órdenes ha producido. En cero con fecha vencida es señal de que algo lo esta deteniendo." },
    ],
    botones: [
      { nombre: "Ejecutar programador", explica: "Convierte planes en órdenes. Le dice plan por plan si genero o por que no." },
      { nombre: "El desplegable de horizonte", explica: "Por omisión genera lo que toca hoy. Ampliarlo a 7 o 30 días adelanta la generación, útil antes de un puente." },
      { nombre: "Generar con IA", explica: "Propone la rutina completa a partir del equipo: actividades, tiempos, refacciones y frecuencia. Se revisa antes de guardar." },
      { nombre: "Sugerir qué consume cada actividad", explica: "En un plan que ya existe, propone qué refacción gasta cada actividad usando SOLO el catálogo de su empresa. Se marca renglón por renglón y nada se guarda hasta que usted le da guardar; lo que ya tenía capturado no se pisa. Aparece en el detalle del plan, y solo mientras alguna actividad no diga qué consume." },
      { nombre: "Lo que falta en el catálogo (dentro de la sugerencia)", explica: "Cuando una actividad consume algo que su almacén no tiene dado de alta, se propone el alta completa —código en el estilo que usted ya usa, nombre, unidad y cantidad— y se puede corregir antes de crearla. Al marcarla, la refacción se da de alta y queda colgada de su actividad en un solo paso. Nace sin existencia ni mínimo: eso se captura en Almacén con el primer conteo o la primera compra. Requiere permiso de almacén, porque el catálogo es de todos." },
      { nombre: "Pausar (en cada renglon)", explica: "Deja de generar órdenes sin borrar el plan ni su historial." },
    ],
    noPuedo: [
      { sintoma: "Di de alta un equipo nuevo y no tiene preventivo", porque: "Aplicar un plan compromete trabajo con una fecha, así que el sistema no lo hace solo. Pero sí lo detecta: aparece un aviso arriba de esta pantalla y en «Equipos y sus planes» se ve cuáles son y se les aplica su plan." },
      { sintoma: "Apliqué el plan a un equipo y no genera órdenes", porque: "Si el plan va por horas de operación, ese equipo necesita su medidor dado de alta. Ejecute el programador: dice el equipo y la causa por su nombre." },
      { sintoma: "Todos los equipos vencen el mismo día", porque: "Se aplicaron con la opción de fecha única. Se puede quitar cada equipo del plan y volver a aplicarlo con las fechas repartidas." },
      { sintoma: "Ejecuté el programador y no generó nada", porque: "El programador ahora le dice el motivo de cada plan. Los más comunes: todavía no entra en la ventana de anticipación, ya existe una orden abierta de ese plan, o el plan no tiene activo asignado." },
      { sintoma: "Genera órdenes demasiado seguido", porque: "Revise el intervalo del plan. Un plan llamado «mensual» con intervalo de 3 días va a generar cada tres días: manda el número, no el nombre." },
    ],
    preguntas: [
      { pregunta: "¿Por qué el plan ya no tiene un campo de un solo equipo?", respuesta: "Porque un plan es para uno o varios equipos iguales. Al crearlo se eligen todos los equipos a los que se aplica. Al editarlo, los equipos se ven arriba y se administran con «Equipos»: el campo de un solo equipo que había antes, al editarlo, guardaba un dato que el programador no lee, y el plan se veía asignado a un equipo al que nunca le generaba órdenes." },
      { pregunta: "¿Dónde digo cuándo se hizo por última vez cada actividad?", respuesta: "En «Equipos», en el renglón de cada equipo, con «Fechas de sus actividades». Ahí se ve cada actividad con su frecuencia, la última vez y la próxima, y se captura por actividad «la última vez se hizo el…» (la próxima se calcula con las reglas de su empresa) o «toca el…» (esa fecha tal cual). Cada equipo lleva sus fechas: corregir uno no mueve a los demás. Lo que ya va en una orden abierta no se corrige ahí: su fecha se mueve al cerrarla. Al aplicar el plan a equipos nuevos también se puede dar una fecha distinta a algunas actividades." },
      { pregunta: "Un plan por horas, ¿de qué medidor toma la lectura?", respuesta: "Del medidor de cada equipo, que se toma al aplicarle el plan. Por eso el plan ya no pide elegir un medidor. Un equipo sin medidor dado de alta aparece marcado «Sin medidor: no genera» en «Equipos»." },
      { pregunta: "Cree un plan y no genera órdenes. ¿Por qué?", respuesta: "Un plan solo genera para los equipos que tiene asignados. Si lo dejó en el catálogo sin asignar, no va a generar nada —es lo correcto, pero conviene saberlo. Vaya a Planes → Equipos y sus planes y asígnele los equipos." },
      { pregunta: "¿El botón de generar plan con IA crea el plan?", respuesta: "No. Lee ese equipo —marca, modelo, historial, medidores— y le propone un borrador que llena el formulario. Usted revisa, ajusta y decide si lo guarda. Nada se guarda hasta que usted lo acepta." },

      {
        pregunta: "¿Cómo hago un plan «por tipo de equipo»?",
        respuesta:
          "Cree el plan y aplíquelo a los equipos que le corresponden. Si tiene compresores tipo A, B y C, son tres planes distintos —con que cambie una actividad o la frecuencia ya son planes diferentes— y cada uno se aplica a sus equipos desde «Equipos y sus planes». El sistema no agrupa por categoría a propósito: le pondría a unos el plan de otros.",
      },
      {
        pregunta: "¿Qué pasa si aplico un plan a un equipo que ya lo tenía?",
        respuesta:
          "No se duplica. El sistema le avisa que ese equipo ya estaba y no lo agrega dos veces.",
      },
      {
        pregunta: "Si mejoro el plan, ¿se mejora para todos los equipos?",
        respuesta:
          "Sí, en su siguiente ciclo. Las actividades y refacciones se copian a la orden en el momento en que se genera, así que las órdenes ya creadas conservan lo que tenían y las nuevas traen la mejora.",
      },
      {
        pregunta: "¿Por qué mi plan por horas de operación no muestra fechas?",
        respuesta:
          "Porque en ese tipo de plan la fecha la manda la lectura del medidor de cada equipo, no el calendario. Si un equipo no tiene medidor dado de alta, no va a generar órdenes y el sistema se lo dice al aplicarlo.",
      },
      {
        pregunta: "Si cierro la orden de un compresor, ¿se mueve la fecha de los otros?",
        respuesta:
          "No. Cada equipo lleva su propia fecha. Cerrar la orden de uno avanza solo ese; los demás conservan la suya. Es lo que hace que se puedan escalonar.",
      },
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
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Todo cuelga de aquí: los planes, las órdenes, las refacciones y los costos se acumulan por activo.",
      "La criticidad decide el orden de atención cuando hay varias cosas detenidas a la vez.",
      "Abajo de todo hay una conversación pegada a este registro: lo que se hable ahí queda aquí para siempre, no en un chat suelto donde se pierde en veinte minutos. Mencione a alguien con el botón @ y le llega un aviso con el texto y la liga. Nombrarse a uno mismo no avisa. Cada quien puede borrar lo suyo, y queda marcado como eliminado en vez de dejar un hueco.",
      "Junto a la conversación están los COMPROMISOS: lo que se acordó y no es una orden de trabajo —cotizar con tres proveedores, hablar con seguridad, mandar el reporte—. Llevan responsable y fecha, y al responsable le llega un aviso que se cierra solo cuando el compromiso se marca hecho. Puede cerrarlo su responsable o quien lo anotó.",
      "Y el botón «Avísenme» de la conversación le manda a usted todo lo que pase con este registro, aunque no sea el responsable ni quien lo pidió. Es copia, no reemplazo: quien tenía que enterarse se sigue enterando.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Codigo", explica: "El identificador que se pinta en el equipo. Es como lo va a buscar el técnico." },
      { nombre: "Activo", explica: "El nombre y, debajo, fabricante y modelo si ya se capturaron de la placa." },
      { nombre: "Criticidad", explica: "A si su falla detiene la operacion o compromete la seguridad; C si se puede vivir sin el unos dias. Decide el orden de atencion cuando hay varias cosas detenidas." },
      { nombre: "Estado", explica: "Operando, degradado, detenido o retirado. Los retirados salen de las listas de trabajo pero conservan su historial." },
      { nombre: "Si para, ¿detiene la producción?", explica: "De aquí sale cuánto CUESTA que este equipo falle. No es lo mismo que la criticidad: el extractor de humos puede ser crítico por seguridad y aun así no detener la línea. Sin definir, sus paros no se cuentan como pérdida — y el sistema le dice cuántos equipos le faltan." },
      { nombre: "Ubicacion", explica: "Donde esta fisicamente. Es lo que permite armar una ruta de recorrido en vez de ir y venir." },
      { nombre: "OT abiertas", explica: "Trabajo pendiente sobre ese equipo. Varias abiertas a la vez suele ser síntoma de que se atiende el síntoma y no la causa." },
      { nombre: "Planes", explica: "Cuantas rutinas preventivas tiene. En cero, ese equipo solo se atiende cuando ya fallo." },
      { nombre: "Garantia", explica: "Si sigue vigente. Antes de pagar una reparación conviene revisarlo." },
      { nombre: "Codigo de reporte (en la ficha)", explica: "El QR del equipo, generado solo. Pegado en la máquina, cualquiera reporta una falla sobre ese activo sin cuenta ni contraseña." },
      { nombre: "Recurrencia de fallas (en la ficha)", explica: "Cuántas veces falló, cada cuánto, cuánto costó y si las fallas se están acercando. Sale del historial y no necesita IA. El análisis del patrón sí." },
    ],
    botones: [
      { nombre: "Nuevo activo", explica: "Alta manual, uno por uno." },
      { nombre: "Levantamiento con IA", explica: "Propone el inventario completo a partir de una descripción de la instalación y fotos de las áreas. Se revisa antes de dar de alta." },
      { nombre: "El bote de basura del renglón", explica: "Elimina un activo capturado por error. Si tiene historial no lo va a dejar, y le dice exactamente que lo detiene." },
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
      "Ver de un vistazo qué familia está sufriendo, en la franja de arriba",
      "Registrar entradas, salidas y ajustes",
      "Ver la existencia de un almacén específico con el selector de arriba",
      "Entrar al kardex, a los traspasos, a los conteos y a los indicadores",
    ],
    flujo: [
      "La franja de arriba dice cómo está el almacén por familia: un cuadro por refacción, y el color dice si hay de menos, de más, o si nadie ha dicho cuánto debería haber. Cada renglón lleva a esa familia.",
      "El gris de «sin mínimo» no es un término medio entre bien y mal: es que esa refacción no tiene mínimo capturado, así que no hay contra qué compararla. Capturarlo es lo que hace que el almacén se pueda vigilar solo.",
      "«Bajo mínimo» quiere decir lo mismo aquí, en la franja y en el análisis del almacén: hay menos de lo que se dijo que debía haber. Las agotadas van incluidas.",
      "Si no se han capturado familias, la franja se ve en un solo renglón y lo dice: al ponerle familia a cada refacción se abre por familia.",
      "La clave abre el expediente de la refacción: existencia por almacén, últimos movimientos, en qué equipos se ha ido, compras, planes que la piden, equivalentes y fichas técnicas. Editar se hace ahí mismo.",
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Cada refacción puede tener equivalentes: la misma pieza de otra marca, o un sustituto que sirve cuando la original no llega. Se registran con el botón «Equivalentes» del renglón.",
      "En un sustituto, la salvedad —«requiere espaciador de 2 mm»— es lo más importante del registro: sin ella alguien monta la pieza equivocada creyendo que hizo bien.",
      "La relación se guarda una sola vez y sirve en los dos sentidos: si A sirve para B, B sirve para A.",
      "La existencia baja sola cuando se surte una requisición o se consume en una orden de trabajo.",
      "Sube cuando se recibe una compra o cuando alguien devuelve lo que no usó.",
      "Cada uno de esos movimientos queda en el kardex con el documento que lo originó.",
      "Abajo hay COMPROMISOS: lo que se acordó y no es una orden de trabajo —avisarle a producción, conseguir un equivalente, pedir una cotización—. Llevan responsable y fecha, y a quien le toca le llega un aviso que se cierra solo al marcarlo hecho.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Codigo", explica: "El identificador interno de la refaccion." },
      { nombre: "Refaccion", explica: "El nombre, su familia y sus adjuntos: fotos, fichas tecnicas y ligas a manuales." },
      { nombre: "Ubicacion", explica: "Donde esta dentro del almacén. Con formato tipo P3-R2-N4 se puede ordenar y armar la ruta del conteo." },
      { nombre: "Existencia", explica: "Cuanto hay. En rojo con etiqueta de reordenar cuando esta en o por debajo del mínimo. Con un almacén elegido arriba, es la existencia de ESE almacén." },
      { nombre: "Nivel", explica: "Que tan lleno esta respecto de su maximo. Verde surtido, amarillo bajo minimo, rojo agotado." },
      { nombre: "Costo unit.", explica: "Costo promedio ponderado. Se recalcula solo en cada entrada; las salidas no lo mueven." },
      { nombre: "Valor en piso", explica: "Existencia por costo. Sumado es el dinero detenido en el anaquel." },
    ],
    botones: [
      { nombre: "Kardex", explica: "El libro del almacen: cada movimiento con su saldo y el documento que lo origino." },
      { nombre: "Traspasos", explica: "Mover existencia de un almacén a otro." },
      { nombre: "Conteos", explica: "Contar el anaquel y cuadrarlo contra el sistema." },
      { nombre: "Indicadores", explica: "Como se esta comportando el almacen: nivel de servicio, rotacion, exactitud." },
      { nombre: "Analisis", explica: "Que comprar y que sobra. Es la pantalla de decisiones, no de consulta." },
      { nombre: "Entrada / Salida (en cada renglon)", explica: "Movimiento manual rápido. Aplica al almacén que tenga elegido arriba." },
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

  "/inventory/equivalencias": {
    titulo: "Equivalencias entre refacciones",
    que: "Qué se puede usar en lugar de qué cuando la refacción original no llega a tiempo.",
    hacer: [
      "Registrar que dos refacciones son la misma pieza de otra marca",
      "Registrar un sustituto con su salvedad",
      "Pedirle a la IA que revise el catálogo y proponga equivalencias",
    ],
    flujo: [
      "Hay dos casos distintos: la misma pieza de otra marca —un balero 6205 de SKF o de NSK es el mismo balero— y el sustituto, que sirve pero con condición.",
      "La relación se guarda una sola vez y sirve en los dos sentidos: si A sirve para B, B sirve para A.",
      "La IA propone; usted acepta. Nada se registra solo.",
      "Una vez registradas, el trabajo pendiente que se trabó por falta de una refacción avisa si hay equivalente con existencia.",
    ],
    campos: [
      { nombre: "Misma pieza", explica: "Intercambiable sin condiciones: cambia la marca, no la pieza." },
      { nombre: "Sustituto", explica: "Sirve, pero con una salvedad que hay que leer antes de mandarlo a montar." },
      { nombre: "Confianza", explica: "Qué tan sostenida está la propuesta con lo que dice su catálogo. Baja significa que el sistema no tuvo con qué sostenerla: verifíquela con la ficha del fabricante." },
    ],
    noPuedo: [
      { sintoma: "La IA no propuso nada", porque: "Solo compara refacciones que comparten designación numérica —un 6205 con otro 6205—. Si su catálogo no trae esos números en el código o el nombre, no hay de dónde sostener una propuesta." },
      { sintoma: "Propuso algo que sé que está mal", porque: "Descártelo. Por eso nada se registra solo. La IA lee su catálogo, no tablas de referencias cruzadas del fabricante." },
    ],
    preguntas: [
      {
        pregunta: "¿Por qué la IA no puede registrar las equivalencias directamente?",
        respuesta:
          "Porque una equivalencia mal registrada manda a montar la pieza equivocada, y eso rompe el equipo o lastima a alguien. El sistema ya impide lo más peligroso —un 6205 y un 6206 nunca se comparan entre sí— pero el resto es criterio de quien conoce el equipo. La IA propone y explica; usted decide.",
      },
      {
        pregunta: "¿De dónde saca la IA las equivalencias?",
        respuesta:
          "De su propio catálogo, no de su memoria. Lee los códigos y nombres de sus refacciones y busca las que comparten designación. No inventa referencias cruzadas del fabricante: si el catálogo no da elementos, dice que no equivalen.",
      },
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
    camposBuscables: true,
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
      { nombre: "Movimiento", explica: "Entrada de compra, salida a mantenimiento, devolución, ajuste de conteo o las dos mitades de un traspaso." },
      { nombre: "Entra / Sale", explica: "Columnas separadas a proposito: es como se lee un kardex y evita confundir el signo." },
      { nombre: "Saldo", explica: "Lo que quedo en ESE almacen despues del movimiento. Es contra lo que se cuadra un conteo fisico." },
      { nombre: "Documento", explica: "El vale, la recepcion de compra, el traspaso o la orden que lo origino. Es liga: lleva al documento completo. En una entrada de compra se lee «RE-000002 · RC-000001» y lleva a la compra, con su proveedor, su remision y quien firmo." },
      { nombre: "Recibio", explica: "Quien recibio el material fisicamente: a quien se le entrego en una salida, o quien firmo la recepcion en una entrada de compra." },
      { nombre: "Registro", explica: "La persona que capturo el movimiento en el sistema. No siempre es la misma que lo recibio." },
    ],
    preguntas: [
      { pregunta: "¿Quién movió esta refacción?", respuesta: "Filtre por esa refacción. Cada renglón trae quién lo registró, quién lo recibió y el documento —vale, recepción de compra, traspaso u orden— que lo originó." },
      { pregunta: "¿Por qué una entrada vieja no trae documento?", respuesta: "Los movimientos anteriores a esta versión solo guardaban la referencia en texto. Se pueden volver a ligar con su recepción: el folio ya está en la referencia y el enlace se reconstruye sin adivinar nada. Pídalo y se hace." },
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
      { nombre: "Sistema", explica: "Lo que el sistema creia que había. Se oculta mientras se cuenta a ciegas." },
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
    camposBuscables: true,
    que: "Lo que mantenimiento le pide al almacén, y el vale con el que se entrega.",
    hacer: [
      "Pedir material contra una orden de trabajo o un activo",
      "Surtir completo o en partes, registrando a quién se entrega",
      "Recibir de vuelta lo que no se usó",
    ],
    flujo: [
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Pedir no descuenta existencia. El almacén baja hasta que se surte.",
      "Cada renglón se liga a la ACTIVIDAD de la orden que necesita ese material, y de ahí sale su tipo: una misma requisición puede llevar el engrase del preventivo y el sello de una falla, cada uno con su clasificación.",
      "Si el material es de la orden completa se elige «Consumo general de la OT» y no se le inventa tipo. Los vales anteriores a este cambio se muestran como «Actividad no especificada»: no se les asigna una actividad sin evidencia.",
      "Lo surtido contra una orden de trabajo se carga como consumo de esa orden y actualiza su costo en el momento.",
      "Lo devuelto baja ese consumo: el cargo original no se borra, se le anota lo que regresó y el costo de la orden queda en lo que de verdad se usó.",
      "Lo que el almacén no puede cubrir se manda a compras sin volver a capturarlo. Lo que ya está en una compra abierta deja de aparecer como faltante, para no comprarlo dos veces.",
      "Si la refacción no tiene costo capturado, se puede surtir, pero se avisa: el consumo entraría en $0 y el costo del equipo saldría corto.",
      "Abajo de todo hay una conversación pegada a este registro: lo que se hable ahí queda aquí para siempre, no en un chat suelto donde se pierde en veinte minutos. Mencione a alguien con el botón @ y le llega un aviso con el texto y la liga. Nombrarse a uno mismo no avisa. Cada quien puede borrar lo suyo, y queda marcado como eliminado en vez de dejar un hueco.",
      "Junto a la conversación están los COMPROMISOS: lo que se acordó y no es una orden de trabajo —cotizar con tres proveedores, hablar con seguridad, mandar el reporte—. Llevan responsable y fecha, y al responsable le llega un aviso que se cierra solo cuando el compromiso se marca hecho. Puede cerrarlo su responsable o quien lo anotó.",
      "Y el botón «Avísenme» de la conversación le manda a usted todo lo que pase con este registro, aunque no sea el responsable ni quien lo pidió. Es copia, no reemplazo: quien tenía que enterarse se sigue enterando.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la requisicion, serie RM." },
      { nombre: "Para", explica: "La orden de trabajo o el activo al que se destina el material, y el motivo." },
      { nombre: "Estado", explica: "Se calcula de los renglones, no se captura: solicitada, surtida en parte, surtida." },
      { nombre: "Urgencia", explica: "Normal, alta o equipo parado. Las de paro salen resaltadas y se cuentan aparte arriba." },
      { nombre: "Por surtir", explica: "Lo que falta entregar. Es la columna que le dice al almacenista que tiene pendiente." },
      { nombre: "Actividad", explica: "La tarea de la orden que pidió ese material. De ella sale el tipo de mantenimiento con que se cuenta el costo." },
      { nombre: "Devuelto", explica: "Lo que regreso sin usarse. Mucha devolución significa que se esta pidiendo de mas por si acaso. Al devolver, el costo de la orden baja solo." },
    ],
    botones: [
      { nombre: "Nueva requisición", explica: "Pedir material. Ofrece solo lo que existe en el almacen elegido, con su cantidad disponible. Al elegir orden de trabajo, el activo se toma de ella: no hay que capturarlo dos veces." },
      { nombre: "Surtir", explica: "Entrega el material y descuenta del almacén. Propone lo que falta, ya recortado a lo que hay." },
      { nombre: "Registrar devolución", explica: "Regresa al inventario lo que se entrego y no se uso." },
      { nombre: "Solicitar a compras", explica: "Aparece cuando el almacén no puede cubrir algo. Manda los renglones faltantes con su cantidad ya cargada." },
      { nombre: "Cerrar requisición", explica: "Da por terminado el asunto: ya no se espera mas movimiento contra ella." },
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

  "/compras/planificador": {
    titulo: "Qué hay que comprar",
    que: "Lo que se va a acabar antes de que alcance a llegar, para pedirlo a tiempo en vez de cuando ya falta.",
    hacer: [
      "Ver qué urge, ordenado por lo que ya va tarde",
      "Cambiar el horizonte: 30, 90 o 180 días",
      "Abrir cualquier renglón para ver de dónde salió la cifra",
      "Desmarcar lo que no quiera y mandar el resto a una requisición de compra",
    ],
    flujo: [
      "Cruza tres cosas: lo que los preventivos programados van a pedir y qué día, lo que de verdad ha salido del almacén en los últimos 180 días, y lo que tarda cada proveedor.",
      "La urgencia no es una escala inventada: compara cuándo se acaba el material contra cuánto tarda en llegar. Una pieza que se acaba en diez días y tarda quince aparece como «Ya va tarde», porque pedirla hoy ya no alcanza.",
      "Lo que ya está pedido y no ha llegado se descuenta. Si lo que viene en camino alcanza, la refacción no aparece: no hay que pedirla otra vez.",
      "Lo planeado y lo consumido NO se suman: el consumo real ya incluye los preventivos que se hicieron, así que sumarlos compraría de más. Se toma el mayor de los dos y cada renglón dice cuál mandó.",
      "La cantidad repone hasta el máximo del almacén si está declarado; si no, cubre la demanda del horizonte más el mínimo.",
      "No crea nada solo. Propone, usted ajusta y la requisición se levanta con los renglones ya cargados.",
      "Lo correctivo no tiene fecha, así que la parte de la demanda que sale del historial es un ritmo, no una predicción. El día en que se acaba se calcula solo con lo que el plan compromete, que es lo único que sí tiene calendario.",
    ],
    campos: [
      { nombre: "Cuándo", explica: "«Ya va tarde» significa que no alcanza a llegar aunque se pida hoy: el material se acaba antes que el tiempo de entrega del proveedor. Debajo dice en cuántos días se acaba y cuántos tarda." },
      { nombre: "Viene", explica: "Lo que ya está pedido en una compra viva y todavía no llega. Se resta de lo que hay que pedir, y por eso una refacción en cero puede no aparecer: ya viene en camino." },
      { nombre: "Va a hacer falta", explica: "La demanda del horizonte. La etiqueta de al lado dice de dónde salió: «plan» si mandaron los preventivos, «uso» si mandó el consumo real, «mín.» si solo se está reponiendo el mínimo." },
      { nombre: "Pedir", explica: "La cantidad propuesta, ya descontado lo que viene en camino. Se puede cambiar en la requisición: esto propone, no decide." },
    ],
    noPuedo: [
      { sintoma: "Sale vacío o con muy poco, y sé que falta material", porque: "Si sus planes no tienen refacciones cargadas, lo que consumen no entra. Arriba se lo dice, con el nombre de los planes. Cárgueselas al plan y vuelva a mirar." },
      { sintoma: "Una refacción que está en cero no aparece", porque: "Porque ya está pedida y lo que viene en camino alcanza. Ábrala en el almacén y verá en qué compra viene." },
      { sintoma: "No me cuadra la cantidad con lo que consumimos", porque: "Lo planeado y lo consumido no se suman: el consumo real ya incluye los preventivos que se hicieron. Se toma el mayor de los dos, y el renglón desplegado dice cuál mandó." },
    ],
  },
  "/compras": {
    titulo: "Requisiciones de compra",
    camposBuscables: true,
    que: "Lo que el almacén no tuvo y hay que adquirir, con quién lo autorizó y qué llegó.",
    hacer: [
      "Solicitar una compra, casi siempre desde una requisición que no se pudo surtir",
      "Autorizar o rechazar con motivo",
      "Anotar la orden de compra y recibir la mercancía",
    ],
    flujo: [
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Si el proceso interno de compras está apagado, se anota el folio de la orden de su propio sistema y salta a recepción. Apagarlo no borra las cotizaciones que ya se hayan capturado: se siguen viendo, solo que sin poder cambiarlas.",
      "Si está encendido, entre autorizar y recibir van las cotizaciones, el comparativo y la orden de compra.",
      "Al recibir, la existencia sube solo por lo que de verdad llegó y el costo promedio de la refacción se recalcula.",
      "Mientras no haya cotización elegida, la tabla muestra lo que se estimó al pedir. En cuanto se elige una, muestra lo cotizado y el total de la compra pasa a ser ese: por eso la cifra de un renglón puede cambiar sin que nadie la edite. Lo que el proveedor elegido no surte se marca «No lo surte» y queda fuera del total, porque tampoco entró en el de su cotización.",
      "Debajo del monto de autorización que tenga configurado su empresa, la requisición nace autorizada y lo dice; de ahí para arriba necesita firma, y sin firma no se puede colocar.",
      "La recepción admite parciales y no se puede recibir más de lo pedido. Si el mismo recibo se envía dos veces —doble clic, reintento— el material entra una sola vez.",
      "Mientras una compra siga viva, el almacén marca esa refacción como «Ya pedida» para que no se vuelva a comprar por mínimo.",
      "Abajo hay COMPROMISOS: lo que se acordó aquí y no es una orden de trabajo —cotizar con tres proveedores, revisar una frecuencia con producción, hablar con alguien—. Llevan responsable y fecha, y a quien le toca le llega un aviso que se cierra solo al marcarlo hecho.",
    ],
    tablaConfigurable: true,
    campos: [
      { nombre: "Folio", explica: "El consecutivo de la requisicion de compra, serie RC." },
      { nombre: "Estado", explica: "Solicitada espera firma; autorizada espera que se coloque; en compra espera que llegue." },
      { nombre: "Monto estimado", explica: "Lo que se calcula que va a costar. Al elegir cotización ganadora se sustituye por el monto real cotizado." },
      { nombre: "Por recibir", explica: "Lo que se pidio y todavía no llega." },
      { nombre: "Orden de compra", explica: "El folio con el que se comprometio al proveedor. Puede ser la que emite MainTrack o la de su propio sistema." },
    ],
    botones: [
      { nombre: "Autorizar / Rechazar", explica: "La firma. Rechazar exige motivo, y el motivo le llega a quien pidio. Nadie puede firmar su propia requisición." },
      { nombre: "Anotar orden del ERP", explica: "Cuando compras vive afuera: se guarda el folio de la orden externa y se salta a recepcion sin perder trazabilidad." },
      { nombre: "Capturar cotización", explica: "Solo con el proceso interno encendido. Registra lo que ofrecio un proveedor para armar el comparativo." },
      { nombre: "Elegir esta", explica: "Marca la cotización ganadora. Si no es la mas barata, exige explicar por que." },
      { nombre: "Emitir orden de compra", explica: "Genera la orden formal con el proveedor ganador, heredando total, condiciones y fecha prometida." },
      { nombre: "Recibir material", explica: "Registra lo que llego contra lo que se pidio, con remisión y revisión fisica. Sube la existencia y recalcula el costo promedio." },
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
      { nombre: "Días de entrega", explica: "Lo que el proveedor dice que tarda. Los indicadores le muestran lo que tarda de verdad." },
      { nombre: "Bajo mínimo", explica: "Cuantas de sus refacciones estan por acabarse. Es una orden de compra por renglon: a quien hay que llamarle hoy." },
      { nombre: "Valor en piso", explica: "Cuanto inventario suyo tiene detenido en el almacén." },
      { nombre: "Gasto acumulado", explica: "Lo que se le ha pagado en servicios externos cargados a órdenes." },
    ],
    noPuedo: [
      { sintoma: "No me deja borrar un proveedor", porque: "Tiene refacciones o servicios ligados. Ese es el rastro de a quién se le compró. Reasigne lo que le cuelga primero." },
    ],
  },

  "/requests": {
    titulo: "Solicitudes de servicio",
    camposBuscables: true,
    tablaConfigurable: true,
    que: "Lo que reporta quien no es de mantenimiento: se revisa y se convierte en orden, o se descarta. Quien reporta ve aquí solo sus reportes («Mis reportes») y en qué van.",
    hacer: [
      "Levantar una solicitud a mano",
      "Revisarla y convertirla en orden de trabajo",
      "Analizar con IA lo que llegó por el portal público",
    ],
    flujo: [
      "Desde el detalle se pasa al anterior o al siguiente con las flechas de junto al título —o con las flechas del teclado—, siguiendo el orden y el filtro de esta lista. No aparecen si se llegó por una liga directa o por la búsqueda.",
      "Es la puerta de entrada del trabajo correctivo desde el resto de la empresa.",
      "La lista se agrupa por estado, prioridad, equipo o quien reportó, se ordena tocando el título de una columna y se le eligen columnas; su arreglo se guarda y es suyo. Quien ve solo sus reportes no tiene la agrupación por solicitante, porque ahí todo es suyo.",
      "Lo que llega por código QR trae el contexto que ese punto tenga: un QR pegado a un equipo trae el equipo; uno a la entrada de un área trae solo el área. Quien reporta nunca escoge equipo, y es a propósito — quien no trae el código tampoco se sabe la clave, y un equipo mal escogido ensucia el historial de uno que no falló y deja sin registro al que sí.",
      "Por eso el equipo lo pone QUIEN REVISA. Al aprobar aparece el buscador de equipos; si la solicitud llegó sin uno, la pantalla lo advierte: una orden sin activo no entra al expediente de ningún equipo ni cuenta en su historial de fallas.",
      "Quien tiene cuenta en el sistema no necesita ningún QR: levanta la solicitud desde aquí, con el buscador de equipos y su foto. El portal público existe para quien NO tiene cuenta.",
      "Al recibir, el sistema revisa el texto en busca de condiciones de riesgo —gas, cable expuesto, humo— y si encuentra alguna, el aviso sale como crítico de inmediato.",
      "Al aprobarla nace una orden de trabajo con su folio propio, o se suma como actividad a una orden abierta del mismo equipo. La solicitud muestra siempre la OT ligada.",
      "Convertir es a prueba de doble clic: aunque se presione dos veces, sale una sola orden. Queda registrado quién la aprobó y convirtió, o quién la rechazó.",
      "Rechazar exige motivo, y quien reportó lo recibe.",
      "El formulario de reporte habla como quien lo ve: qué sucede, dónde, qué tan urgente parece, si impide trabajar, si hay riesgo, fotos y un teléfono. Lo técnico lo decide quien revisa. Si hay riesgo, el aviso sale como crítico.",
      "Lo que se escribe y no se envía se conserva unas horas en ese dispositivo (si se cae la señal o se cierra sin querer). Las fotos se eligen antes, se ven, se pueden quitar, y se suben al enviar; si una falla, se reintenta sola esa.",
      "Quien reporta y el técnico ven sus propias solicitudes (el técnico, también las de sus órdenes); quien revisa, todas.",
      "Una solicitud convertida que no tiene una OT activa —porque nunca quedó ligada a una orden, o porque su orden está cancelada— se muestra «Sin OT activa» y aparece en la calidad de captura. El sistema no le inventa ni le reasigna una orden: alguien decide si se vuelve a atender.",
      "Abajo de todo hay una conversación pegada a este registro: lo que se hable ahí queda aquí para siempre, no en un chat suelto donde se pierde en veinte minutos. Mencione a alguien con el botón @ y le llega un aviso con el texto y la liga. Nombrarse a uno mismo no avisa. Cada quien puede borrar lo suyo, y queda marcado como eliminado en vez de dejar un hueco.",
      "Junto a la conversación están los COMPROMISOS: lo que se acordó y no es una orden de trabajo —cotizar con tres proveedores, hablar con seguridad, mandar el reporte—. Llevan responsable y fecha, y al responsable le llega un aviso que se cierra solo cuando el compromiso se marca hecho. Puede cerrarlo su responsable o quien lo anotó.",
      "Y el botón «Avísenme» de la conversación le manda a usted todo lo que pase con este registro, aunque no sea el responsable ni quien lo pidió. Es copia, no reemplazo: quien tenía que enterarse se sigue enterando.",
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
      { sintoma: "No me deja rechazar", porque: "Falta el motivo del rechazo. Es obligatorio: quien reportó merece saber por qué no se atiende." },
      { sintoma: "Dice que la solicitud ya fue revisada", porque: "Alguien más la convirtió o la rechazó mientras usted la tenía abierta. Recargue la página para ver su estado y su orden." },
      { sintoma: "No me deja sumarla a una orden", porque: "La orden ya está completada, cerrada o cancelada, o es de otro equipo." },
      { sintoma: "No veo el botón de analizar", porque: "El triage con IA se incluye en los planes con inteligencia artificial. La detección de riesgo, en cambio, funciona en todos los planes porque no usa IA." },
    ],
    preguntas: [
      { pregunta: "¿Por qué la solicitud no me pregunta si es falla, mejora o apoyo?", respuesta: "Porque quien reporta casi nunca sabe la diferencia, y ponerle ese menú enfrente produce clasificaciones al azar o hace que no reporte. A quien reporta se le pregunta lo que sí sabe: qué pasa y qué tan urgente lo siente. La clasificación la hace usted al revisarla, con la IA proponiendo." },
      { pregunta: "¿Qué diferencia hace clasificarla bien?", respuesta: "Decide cómo cuenta el trabajo. Una Falla entra al Pareto de modos de falla y al tiempo entre fallas. Una Mejora no. Un Apoyo —prestar manos a producción, mover algo— registra sus horas y su costo pero no cuenta como falla del equipo ni como mantenimiento planeado: si entrara como correctivo le diría que sus máquinas fallan más de lo que fallan." },
      { pregunta: "Cancelé la orden de una solicitud. ¿Se perdió?", respuesta: "No. Al cancelar la orden, la solicitud vuelve a Pendiente y se puede volver a atender en otra. Si después reabre la orden cancelada, retoma sus solicitudes salvo las que alguien más ya haya tomado." },
      { pregunta: "El técnico encontró algo más mientras trabajaba. ¿Cómo lo reporta?", respuesta: "Desde la misma orden, con «Agregar un reporte». Puede sumar uno que ya estaba esperando para ese equipo, o levantar uno nuevo ahí mismo. Queda con folio propio, en el listado de solicitudes y en el historial del equipo, ya ligado a la orden donde se va a atender." },

      { pregunta: "¿La IA cambia la solicitud sola?", respuesta: "No. Todo lo que propone es sugerencia; usted decide al aprobarla. Una solicitud mal clasificada por una máquina sin que nadie mire es peor que una sin clasificar." },
    ],
  },

  "/calendar": {
    titulo: "Calendario de mantenimiento",
    que: "Lo que está programado, lo que se proyecta y si de verdad cabe en los días que quedan.",
    hacer: [
      "Ver el mes, la semana con el trabajo de cada persona, o un solo día a detalle",
      "Abrir cualquier día para ver todo lo que cae ahí",
      "Filtrar por técnico, tipo de mantenimiento, familia de equipo o equipos concretos",
      "Ver la carga de cada persona y qué días no alcanzan",
      "Generar las órdenes de los planes que ya vencen",
      "Pedirle a la IA que revise la semana y proponga qué mover",
    ],
    flujo: [
      "Las órdenes se pintan en su fecha compromiso, con el color de su tipo y un punto del color del responsable.",
      "Las proyecciones con línea punteada son planes que todavía no generan orden: aparecen para que se vea lo que viene.",
      "Un plan aplicado a varios equipos proyecta una línea por equipo, cada una en su propia fecha. Si ve el mismo plan varias veces en el mes, son equipos distintos.",
      "Lo vencido y sin cerrar sale arriba siempre, sin importar el mes que esté viendo. Se quedaba escondido en el mes en que venció.",
      "Un día en ámbar es un día donde a alguien no le cabe el trabajo asignado. Al abrirlo aparece «Cómo resolver la sobrecarga»: cuántas horas le sobran a cada persona, en qué días del rango que está viendo sí le caben y quién más tiene lugar ese día. Es una propuesta calculada con la misma carga; el cambio se hace en la orden.",
      "La vista de semana pone a cada persona en su renglón: ahí se ve si alguien trae tres días saturados mientras otro está libre. En el mes eso queda escondido porque todo se mezcla por día.",
      "La vista de día muestra una sola jornada completa: la carga de cada quien y todas sus órdenes con sus horas. Es la vista para arrancar la mañana.",
      "El botón «Ejecutar programador» crea las órdenes de los planes que ya vencieron, y dice por qué saltó las que no generó.",
      "«Revisar la semana» le pide a la IA que lea la carga real y proponga qué mover, qué juntar en una sola visita y qué no tocar. Es una propuesta: no cambia nada, usted decide qué aplicar. Revisa la semana que está viendo: en la vista de mes, la semana de hoy (o la primera del mes si ve otro mes); el resultado dice qué semana revisó. Tarda de 15 segundos a un minuto; si no hay respuesta en dos minutos o se cae la conexión, se cancela y lo dice.",
    ],
    campos: [
      { nombre: "Las horas de la esquina del día", explica: "La suma de horas estimadas de lo asignado ese día. En ámbar cuando alguien pasa de su jornada." },
      { nombre: "Punto de color", explica: "El responsable de esa orden. Sirve para ver de un vistazo cómo está repartido el trabajo." },
      { nombre: "Filtro de equipos", explica: "Se pueden elegir varios equipos a la vez: quedan como fichas arriba del calendario y solo se ve lo de ellos. Sirve para seguir un compresor en particular o los tres que van a paro el mismo día." },
      { nombre: "Familia de equipo", explica: "Muestra solo una familia —todos los compresores, todo bombeo— sin elegirlos uno por uno. Si ya escogió equipos concretos, la familia se desactiva: la selección manda." },
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
        pregunta: "¿Cómo veo solo el calendario de un equipo?",
        respuesta:
          "Con el buscador de equipos de la barra de filtros. Escriba la clave o el nombre y elíjalo; puede agregar varios y quedan como fichas arriba. El filtro aplica también a las proyecciones punteadas, así que ve el panorama completo de ese equipo y nada más.",
      },
      {
        pregunta: "¿La IA mueve las órdenes por mí?",
        respuesta:
          "Solo si usted lo aplica. Cada propuesta trae su botón «Aplicar», y hay uno para aplicarlas todas. Nada cambia antes de eso. Al aplicar, el sistema vuelve a verificar que la fecha sea laborable y que la orden siga abierta —la sugerencia viene de un modelo y pasa por el navegador, así que no se da por buena—. Todo movimiento aplicado queda en la bitácora.",
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
    hacer: [
      "Arrastrar órdenes entre columnas para cambiar su estado",
      "Acotar el tablero a una familia de equipo, a equipos concretos, a un responsable o a un tipo de mantenimiento",
    ],
    flujo: [
      "Es la misma información que la lista de órdenes, vista por avance en vez de por renglones.",
      "Arrastrar sirve para los pasos que no piden datos. Completar, pausar, cancelar o iniciar una orden sin responsable se hacen desde la orden: el tablero le dice qué falta y le da el enlace.",
      "Los filtros son los MISMOS del calendario, con los mismos nombres: responsable, tipo de mantenimiento, familia de equipo y equipos concretos. Quien aprende a acotar una pantalla ya sabe acotar la otra.",
      "Elegir equipos concretos manda sobre la familia: si escogió tres compresores y luego una familia distinta, siguen mandando los equipos, porque es lo último que usted señaló.",
      "Con filtro puesto, el conteo y las horas de cada columna son de lo que se está viendo, y arriba se dice cuántas órdenes quedaron fuera. Arrastrar sigue funcionando igual, y el filtro se conserva al mover una tarjeta.",
    ],
  },

  "/meters": {
    titulo: "Medidores",
    que: "Las lecturas de horas, kilómetros o ciclos que disparan mantenimiento por uso.",
    hacer: [
      "Capturar lecturas, con fecha pasada si hace falta",
      "Registrar el reinicio o la sustitución de un medidor",
      "Corregir o anular una lectura mal capturada (supervisor en adelante)",
      "Configurar el tipo de medidor y su uso máximo por día",
    ],
    flujo: [
      "Un plan por medidor no dispara por calendario sino cuando la lectura alcanza el intervalo.",
      "Un horómetro que suma más horas que las transcurridas en el reloj es físicamente imposible: se bloquea y no se acepta con justificación. El mensaje dice la lectura anterior, la nueva, el incremento, las horas naturales y el máximo, y qué hacer: corregir, registrar sustitución o registrar reinicio.",
      "Un reinicio o una sustitución también se corrige o se anula, con motivo, conservando el valor, el tipo, el usuario y la fecha originales.",
      "Cada lectura, corrección o anulación recalcula el valor actual, el promedio diario y la fecha estimada de los planes por uso.",
      "El promedio diario es el uso de los últimos 90 días entre los días que abarcan las lecturas, sin mezclar un medidor sustituido con el nuevo.",
      "Sin lecturas al día, esos planes no generan nunca.",
    ],
    campos: [
      { nombre: "Tipo de registro", explica: "«Lectura normal» no puede bajar. «Reinicio» o «Sustitución» es lo único que permite un valor menor, pide motivo y recorre la meta de los planes: lo que les faltaba contra el medidor viejo es lo que les falta contra el nuevo." },
      { nombre: "Uso máximo por día", explica: "Arriba de este uso la lectura es atípica: el sistema muestra lectura anterior, nueva, incremento, tiempo transcurrido y promedio, y solo la guarda si confirma con una justificación. Un horómetro nunca acepta más horas que las del reloj, tenga o no máximo." },
      { nombre: "Corregida · original", explica: "La lectura se corrigió: se muestra el valor que se capturó primero, quién corrigió, cuándo y por qué. Nada se borra." },
    ],
    noPuedo: [
      { sintoma: "Dice que la lectura es menor que la anterior", porque: "Un medidor no retrocede. Si se reinició o se cambió, regístrelo como tal; si la lectura anterior está mal, corríjala." },
      { sintoma: "Dice que un horómetro no puede sumar tantas horas", porque: "Entre las dos lecturas pasaron menos horas de reloj que las que marca. Es imposible, no atípico: revise la captura o la lectura anterior." },
      { sintoma: "No me deja anular un reinicio o una sustitución", porque: "Hay lecturas posteriores que se midieron contra ese punto de partida y quedarían sin continuidad; el mensaje dice cuáles. Corrija el valor o el tipo del evento, o anule primero esas lecturas. Al anularlo o corregirlo, la meta de los planes por uso se recorre sola." },
      { sintoma: "Dice «Proyección suspendida»", porque: "El medidor tiene una lectura inválida (menor que la anterior o físicamente imposible). Mientras exista no se estima fecha ni se generan órdenes por uso, porque saldrían de esa lectura. Corríjala o anúlela —el aviso lleva a ella— y la proyección se reanuda sola." },
      { sintoma: "El medidor dice «Sin lectura vigente»", porque: "Todas sus lecturas están anuladas y no tiene un valor inicial registrado. No se muestra una lectura anulada como actual ni se proyecta nada con ella: registre una lectura nueva." },
    ],
  },

  "/predictive": {
    titulo: "Predictivo",
    camposBuscables: true,
    que: "Sensores y tendencias que avisan antes de que algo falle.",
    hacer: ["Registrar sensores y sus lecturas", "Ver qué variables se están saliendo de rango"],
    flujo: [
      "El estado (Normal, Advertencia, Crítico, Sin datos suficientes) sale de la última lectura contra los umbrales. Sobre el crítico es Crítico aunque la tendencia sea estable.",
      "La tendencia y las fechas estimadas de cruce salen de una regresión lineal con al menos 5 lecturas que abarquen un día. Con menos, dice «Datos insuficientes para proyectar».",
      "Estado, tendencia, pendiente, confianza y fecha salen de la MISMA regresión: la pendiente que se muestra es la que calcula la fecha (distancia al umbral ÷ pendiente, desde la última lectura).",
      "«Estable» quiere decir que la pendiente no se distingue del ruido de las lecturas (estadístico t menor a 2). Una subida significativa hacia el umbral se llama «Empeorando» y lleva fecha de cruce.",
      "Cuando no hay fecha, se dice por qué: umbral ya superado, datos insuficientes, pendiente no significativa, tendencia que se aleja del umbral, confianza insuficiente (R² bajo) o cruce a más de 10 años.",
      "Se estiman dos fechas: cuándo cruzaría el umbral de advertencia y cuándo el crítico. No es una fecha de falla: no hay modelo de falla.",
      "Cuando el punto entra en advertencia, en crítico, o su tendencia cruzaría el crítico en 30 días o menos, se abre UNA alerta por punto; si empeora, se escala la misma.",
    ],
    campos: [
      { nombre: "Confianza", explica: "Alta, media o baja según qué tan bien se ajustan las lecturas a una recta. Con confianza baja no se proyecta fecha. No se muestra como porcentaje: con pocas lecturas un número así aparenta una precisión que no existe." },
      { nombre: "Proyección vencida", explica: "La fecha estimada ya pasó y el umbral no se cruzó. No se presenta como fecha futura." },
    ],
  },

  "/alerts": {
    titulo: "Alertas",
    que: "Lo que el sistema detectó y necesita que alguien decida.",
    hacer: ["Revisar la alerta", "Convertirla en orden de trabajo o darla por atendida", "Validar la normalización de un punto que regresó a normal"],
    flujo: [
      "Vienen del predictivo y de las revisiones automáticas. No se capturan a mano.",
      "Cada alerta muestra el estado de HOY del punto, su tendencia y las fechas estimadas de cruce, recalculadas con las lecturas actuales; «Al detectar» es el mensaje original.",
      "Una alerta no se cierra sola cuando el valor regresa a normal: aparece «Normalizada: por validar» para que alguien confirme que no fue un sensor desconectado o una lectura suelta.",
      "Completar o cerrar la orden predictiva NO cierra la alerta: terminar el trabajo no prueba que la condición se corrigió. La alerta sigue activa mientras el punto esté fuera de rango.",
      "«Resolver» y «Validar normalización» solo proceden cuando una lectura mostró el punto en normal; la alerta guarda esa lectura como evidencia, y quién la cerró y cuándo.",
      "«Descartar» es para falsas alarmas y pide el motivo.",
    ],
  },

  "/consulta": {
    titulo: "Pregunte a sus datos",
    que: "Preguntas en español sobre su propia operación, contestadas con sus datos reales.",
    hacer: [
      "Preguntar cosas como «¿qué equipo me costó más este trimestre?» o «¿qué refacciones se acabaron?»",
      "Escuchar la respuesta, con el botón de bocina de cada una",
      "Copiar la respuesta, para pegarla en un correo o en una junta",
      "Cambiar al modo hablado: toque el micrófono, haga su pregunta y el sistema contesta en voz alta (plan Enterprise)",
    ],
    flujo: [
      "No inventa: consulta sus órdenes, activos, almacén y costos con herramientas de solo lectura.",
      "Nunca ve datos de otra empresa: la organización la pone el servidor, no la pregunta.",
      "Lo que se escucha es exactamente la respuesta que está en pantalla: no se le vuelve a preguntar a la IA para leerla, así que oír y leer nunca se contradicen, y no se cobra dos veces la misma respuesta.",
      "Al decirla se traducen los importes y porcentajes a como los diría una persona —«128 mil 400 pesos», «87.5 por ciento»— sin redondear ninguna cifra. Los códigos de equipo se dicen tal cual, porque así se llaman en la planta.",
      "La voz es la que cada quien escogió en Ajustes → Apariencia.",
      "El modo hablado es otra forma de usar lo mismo, no otra cosa: escribiendo se relee y se compara; hablando se va en el camino. Por eso se entra a propósito, con «Prefiero preguntar y escuchar», y se sale con «Volver al modo escrito».",
      "Mientras revisa sus datos dice «déjeme revisar» en vez de quedarse callado: entre la pregunta y la respuesta pasan segundos, y un silencio largo se siente como que se descompuso.",
      "La pregunta se graba y se entiende en el servidor, no en el teléfono: el reconocimiento de voz del navegador no existe en el iPhone, que es justo donde esto sirve. La grabación se corta sola a los 30 segundos.",
      "El permiso del micrófono se pide una sola vez por visita, no en cada pregunta. Si el teléfono lo vuelve a pedir cada vez que entra, es Safari: instale MainTrack en la pantalla de inicio —Compartir → Agregar a inicio— y el permiso se queda guardado, además de que abre sin barra del navegador.",
      "Al salir del modo hablado se suelta el micrófono, para que no quede el indicador de grabación encendido en el teléfono.",
      "Si no se entiende lo que dijo —ruido de planta, el teléfono lejos— lo dice y se puede repetir o escribir. No contesta una pregunta que usted no hizo.",
      "Mientras revisa los datos se oye un pulso suave. Está a propósito: un silencio en medio de una conversación se siente como que se cortó la llamada. Se calla solo en cuanto empieza a contestar.",
      "El modo hablado NO modifica nada, a propósito: se piensa para usarse en el camino, y dictar el cierre de una orden manejando es capturar mal un dato que después nadie puede explicar.",
      "Todo lo que se dice queda también escrito abajo, porque escuchando no hay forma de comprobar una cifra.",
      "Cada empresa tiene un máximo de audios al mes. Al llegar, la voz se apaga y se avisa; lo escrito sigue funcionando igual.",
    ],
    botones: [
      { nombre: "Escuchar la respuesta", explica: "Lee en voz alta esa respuesta. Vuelto a tocar, la detiene. Solo suena una a la vez." },
      { nombre: "Prefiero preguntar y escuchar", explica: "Entra al modo hablado. Se sale con «Volver al modo escrito»." },
      { nombre: "Micrófono", explica: "Toque para hablar, toque otra vez al terminar. Se corta solo a los 30 segundos. Si prefiere, el campo de abajo sigue aceptando la pregunta escrita." },
      { nombre: "Copiar", explica: "Copia esa respuesta al portapapeles, tal como está escrita." },
    ],
  },

  "/diagnostico": {
    titulo: "Diagnóstico con IA",
    que: "Un análisis del estado de la operación, con fortalezas, riesgos y qué atender primero.",
    hacer: ["Generar el diagnóstico del periodo", "Revisar las áreas de oportunidad"],
    flujo: [
      "Cada diagnóstico es una fotografía de la operación al momento de generarse: sus cifras no se recalculan. La pantalla muestra fecha, hora, periodo y zona, y avisa si hay datos registrados después.",
      "«Generar diagnóstico actualizado» agrega uno nuevo; los anteriores se conservan.",
      "Los números se calculan en el sistema; la IA los interpreta pero no los inventa. Son los mismos indicadores, periodo y zona horaria que el Panel y Reportes.",
      "La calidad de la captura sale de las mismas reglas de calidad de datos: errores (datos imposibles), advertencias (datos sospechosos) y recomendaciones (datos que faltan). Cada una lleva a los registros exactos.",
      "Las reglas del proceso de órdenes —terminadas sin horas, correctivas sin diagnóstico, paros sin duración, activas sin responsable, solicitudes convertidas sin OT activa y actividades sin resolver— son críticas: cada 1 % de incumplimiento resta 3 puntos a esa regla, y en el índice pesan el doble que las demás. Así una cuenta con esas carencias no aparece con calidad casi perfecta. Es aritmética, sin IA.",
      "Se genera solo cada semana, y puede pedirlo cuando quiera.",
    ],
  },

  "/conjuntos": {
    titulo: "Mapa de líneas, sistemas y servicios",
    que: "Sus líneas (o sistemas, servicios, rutas) dibujadas como de verdad están, con el estado vivo de cada equipo, lo que costaron y lo que traen pendiente.",
    hacer: [
      "Agrupar los equipos que dependen unos de otros, aunque estén en áreas distintas",
      "Ver de un vistazo si lo que alguien cuida está completo o tiene algo abajo",
      "Saber qué equipos no están en ningún grupo todavía",
      "Poner nombre y responsable a cada uno",
      "Entrar a uno y dibujarlo: acomodar sus equipos como de verdad están",
      "Ver de reojo cada mapa en su miniatura, con la misma vista que el mapa: cómo está ahora, lo que costó o lo que trae pendiente",
      "Filtrar los mapas por sitio (la planta), por clasificación (Producción, Servicios auxiliares…) y por categoría de equipo (compresores, bombas…), para enfocarse en una parte de una instalación grande",
      "Volver de un toque al último mapa que abrió, y desde la ficha de un equipo, verlo en el mapa de cada línea donde está",
    ],
    flujo: [
      "El nombre lo pone su tipo de instalación: en una planta es «Mapa de líneas», en un edificio «Mapa de sistemas», en un club o un hotel «Mapa de servicios», en una flotilla «Mapa de rutas». Si la empresa usa su propia palabra, el mapa la toma.",
      "Cada línea puede llevar sitio y clasificación. Sin sitio asignado, se toma el de la mayoría de sus equipos (aparece con asterisco), así que las líneas que ya existían se filtran por planta sin capturar nada. La clasificación es libre y la pantalla sugiere las que ya se usan.",
      "Con una categoría elegida, quedan solo las líneas que tienen equipos de esa categoría; en cada miniatura los demás equipos se atenúan sin moverse, y los números de la tarjeta cuentan solo esa categoría. Al entrar al mapa, abre con el mismo filtro.",
      "En «lo que costó», las miniaturas se pintan contra el equipo con más paro de todas las líneas a la vista: así se comparan entre sí. Al entrar a un mapa se abre en la misma vista.",
      "Un grupo NO es un área. Las áreas son geografía y son exclusivas —un equipo está en un solo lugar—; los grupos son función y se traslapan. La subestación puede alimentar la línea, los elevadores y la alberca al mismo tiempo, y estar en los tres.",
      "El estado sale del estado vivo de cada equipo. Un equipo se marca abajo solo cuando entra a ejecución una orden que requiere paro, y vuelve a operar al completarse: nadie tiene que acordarse de actualizarlo.",
      "Los equipos que no están en ningún grupo se calculan solos y aparecen abajo. Un equipo nuevo entra ahí sin que nadie lo ponga: por eso no existe un grupo de «Equipos varios» que alguien tenga que mantener.",
      "Toque la miniatura, el nombre o «Ver mapa» para entrar. Ahí acomoda sus equipos como de verdad están y el color le dice qué pasa con cada uno. La miniatura solo muestra los equipos ya colocados.",
      "El mismo acomodo se ve de tres maneras: «cómo está ahora» (el estado vivo de cada equipo), «lo que costó» (horas de paro y dinero, con su periodo) y «lo que trae pendiente» (planes vencidos y órdenes abiertas). Cruzado con el filtro de familia, cada combinación es la pregunta de alguien: solo compresores + cómo están ahora es la mañana del jefe de mantenimiento; solo bombas + lo que costó es su junta de presupuesto.",
      "En el lienzo, si su línea es una cadena, acomódela de izquierda a derecha: el dibujo dice el orden sin que el sistema guarde ninguna secuencia. El mismo equipo puede estar en varios grupos y tiene una posición distinta en cada lienzo — acomodar uno no mueve los demás.",
      "Dos equipos nunca quedan encimados. Si suelta uno sobre otro se intercambian de lugar; si cae sobre varios, se va al primer hueco libre.",
      "Abajo hay COMPROMISOS: lo que se acordó y no es una orden de trabajo. Un sistema lo miran varias áreas a la vez, así que aquí es donde se apunta quién hace qué —«producción confirma la ventana», «eléctrico revisa el arrancador»— con responsable y fecha, y un aviso que se cierra solo al marcarlo hecho.",
    ],
    botones: [
      {
        nombre: "Va solo",
        explica:
          "Marca ese equipo como independiente a propósito: el calentador del baño de oficinas no va a pertenecer a ninguna línea nunca. Deja de contar como pendiente pero sigue a la vista, en el otro grupo. Es la diferencia entre «nadie lo ha acomodado» y «ya se decidió que va solo».",
      },
      {
        nombre: "Acomodar",
        explica:
          "Dentro del lienzo de un grupo, entra al modo de acomodo: arrastre cada equipo y jale la esquina de abajo para cambiar su tamaño. Nada se guarda hasta que toque «Guardar acomodo», así que puede probar sin miedo; cancelar lo descarta a propósito.",
      },
      {
        nombre: "Eliminar",
        explica:
          "Solo funciona si el grupo está vacío, y si no, le dice cuántos equipos lo impiden. Si el grupo ya no se usa pero quiere conservarlo, desactívelo en vez de borrarlo.",
      },
    ],
    campos: [
      { nombre: "El estado", explica: "Completo es que ninguno de sus equipos está abajo ni degradado. Detenido es que al menos uno lo está — y si ese equipo detiene la producción, lo dice aparte, porque no es lo mismo que pare un extractor a que pare el torno." },
      { nombre: "Responsable", explica: "Quién responde por que esto funcione. Sin un nombre, el grupo vuelve a ser una etiqueta: la mitad del valor es que haya alguien a quien preguntarle." },
      { nombre: "Clave", explica: "Se genera del nombre si la deja vacía, y no se puede cambiar después. Si su planta ya tiene sus propias claves —L4, SIS-ELEV— use las suyas." },
      { nombre: "El color en el lienzo", explica: "Depende del lente. En «cómo está ahora» es el estado vivo, que se mantiene solo: cuando entra a ejecución una orden que requiere paro, el equipo se marca detenido, y al completarse vuelve. Toque un equipo para ver sus órdenes." },
      { nombre: "«Ver solo» una familia", explica: "Los equipos de otras familias NO desaparecen: se quedan dibujados en gris. Sin ellos se perdería dónde están los que está viendo, que es lo único que este dibujo tiene y una lista no." },
      { nombre: "El color de «lo que trae pendiente»", explica: "Es una escala absoluta, no contra el peor equipo: uno con una orden abierta sale claro aunque sea el único. Un plan vencido pesa el doble que una orden abierta — la orden es trabajo en curso; el plan vencido es trabajo que ya debió hacerse." },
      { nombre: "La etiqueta «detiene»", explica: "Ese equipo está marcado como que su paro detiene la producción. Es lo que separa una falla cara de una molesta, y de ahí salen los costos de paro." },
      { nombre: "«23 de 73 equipos»", explica: "Cuántos de sus equipos están en algún grupo. Es la medida de qué tan armada está su instalación, y baja sola cuando da de alta equipos nuevos." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de crear", porque: "Crear grupos cambia lo que ve toda la organización, así que pide el mismo permiso que dar de alta un activo. Quien no lo tiene los ve pero no los modifica." },
      { sintoma: "Un equipo aparece en «sin acomodar» aunque ya lo puse en un grupo", porque: "El grupo está desactivado. Un grupo apagado no cuenta como hogar: sus equipos vuelven a estar sueltos, que es lo correcto — si se apagó la Línea 4, esos equipos ya no están cuidados por nadie." },
      { sintoma: "Dice que un equipo está operando y yo sé que está descompuesto", porque: "Nadie ha levantado la orden, o la orden no requiere paro del equipo. El sistema sabe lo que le contaron: mientras no haya orden en ejecución, el equipo se reporta operando." },
      { sintoma: "Acomodé los equipos y al volver están en otro lado", porque: "No guardó. El acomodo se conserva hasta que toca «Guardar acomodo»." },
      { sintoma: "Un equipo no aparece en el lienzo de su grupo", porque: "Está dado de baja. Conserva su historia dentro del grupo pero no se dibuja: ocuparía lugar por algo que ya no existe." },
      { sintoma: "No puedo eliminar un grupo", porque: "Todavía tiene equipos adentro. Quítelos primero, o desactívelo para conservarlo con su historia sin que aparezca en la lista." },
    ],
  },

  "/paros": {
    titulo: "Dónde para la planta",
    que: "Qué áreas detuvieron la producción, cuánto costó y si va mejorando.",
    hacer: [
      "Ver de un vistazo qué área concentra el daño",
      "Saber cuánto costó en dinero, no solo en horas",
      "Comparar contra el periodo anterior del mismo largo",
      "Simular cuánto bajaría la pérdida sin un equipo",
    ],
    flujo: [
      "El periodo es el mismo de Reportes e Indicadores: días completos en la zona horaria de la empresa, y la línea de tiempo termina en el último día incluido.",
      "«Mantenimiento planeado» es todo paro planeado de cualquier equipo: la misma cifra que «Paro planeado» en Reportes. La pérdida en dinero cuenta solo el paro NO planeado de equipos que detienen la producción; el no planeado de equipos que no detienen se muestra por área, sin costo.",
      "En el croquis el COLOR es el daño y el tamaño es geografía: las cajas están donde usted las puso, no ordenadas por lo que costaron. Por eso cada una trae sus horas y sus pesos escritos adentro.",
      "El croquis arranca con las áreas repartidas en la rejilla. Ese acomodo no adivina su planta —acertar a medias sería peor—: es un punto de partida para que usted las arrastre a donde de verdad están.",
      "Soltar un área encima de otra las intercambia de lugar. Es la forma rápida de acomodar cuando la rejilla ya está llena y no hay hueco a dónde mover.",
      "Solo cuentan los equipos marcados como que detienen la producción, a la tarifa de su ubicación. Sin esa marca se le cargaría a la extracción de humos el costo completo de la nave.",
      "El mantenimiento planeado se reporta aparte y NO se cuenta como pérdida: contarlo así haría ver caro justamente lo que conviene fomentar.",
      "Los periodos son ventanas móviles y no trimestres de calendario. «Este trimestre» a cinco días de empezado compararía cinco días contra noventa y mostraría un desplome que no ocurrió.",
      "Un arrastre de menos de un día se ignora: casi siempre es un toque que se resbaló, y aplicarlo dejaría la pantalla vacía sin que se entienda por qué.",
      "«Por qué para» agrupa las fallas del periodo por la FAMILIA de su causa raíz —práctica de mantenimiento, operación, desgaste, ambiente— y dice qué se hace con cada una: un pico en operación no lo arregla ningún plan de mantenimiento, es capacitación. Arriba dice sobre cuántas fallas está hablando: las que se cerraron sin causa no entran en el reparto y se cuentan aparte, porque un porcentaje sobre la mitad de los datos es un número preciso y falso.",
    ],
    botones: [
      {
        nombre: "¿Por qué para esta área?",
        explica:
          "La IA lee las órdenes de trabajo del área en el periodo que usted está viendo y le explica qué pasó, en pesos y sin jerga. Dice qué conecta a los equipos que fallaron, y si eso coincide con lo que usted declaró que no puede parar. Trae una etiqueta de confianza: cuando las órdenes no explican por qué falló, lo dice en vez de inventar.",
      },
      {
        nombre: "El monto de cada equipo",
        explica:
          "Tóquelo para quitarlo de la cuenta y ver cuánto bajaría la pérdida sin él. Es lo que valdría resolverlo de raíz, calculado sobre lo que ya pasó — no una promesa.",
      },
    ],
    campos: [
      { nombre: "El total", explica: "Dice «al menos» cuando falta captura: entonces es un piso, no el dato. Debajo aparece exactamente qué falta y dónde se completa." },
      { nombre: "La flecha", explica: "Compara contra el periodo anterior del mismo largo. Rojo hacia arriba es peor: más pérdida. Sin periodo anterior no inventa un porcentaje." },
      { nombre: "Acomodar mi planta", explica: "Pone el croquis en modo de acomodo: arrastre cada área a donde de verdad está y jale la esquina de abajo para cambiar su tamaño. Se guarda para toda la organización, no solo para usted, porque el croquis es de la planta y no de quien lo abre. Solo quien administra la configuración puede moverlo." },
      { nombre: "El croquis", explica: "Su planta como usted la ve, no como la ordena una gráfica. Cuando el dibujo coincide con la geografía que ya tiene en la cabeza —«el área de tornos, allá al fondo»— deja de ser una gráfica y pasa a ser SU planta. Toque un área para ver qué equipos la detuvieron." },
      { nombre: "El latido de la planta", explica: "Cada marca es un paro: dónde está dice cuándo, qué tan alta dice cuánto duró, y el color si detuvo producción, fue mantenimiento planeado, o paró sin costar. Una barra mensual escondería lo que más importa: un equipo que para cada tres semanas tiene un patrón; uno que paró dos veces tuvo dos accidentes, y se atienden distinto." },
      { nombre: "Arrastrar sobre la línea", explica: "Escoge cualquier tramo, no solo los de los botones. Todo se recalcula sobre ese tramo —incluida la comparación, que se hace contra el periodo anterior del mismo largo— y la pregunta a la IA se limita a él. El tramo queda en la dirección de la página, así que se puede mandar por correo." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de acomodar el croquis", porque: "Acomodar la planta cambia lo que ve toda la organización, así que pide permiso de configuración. Quien no lo tiene ve el croquis y puede tocarlo, pero no moverlo." },
      { sintoma: "Arrastré un área y regresó a otro lado", porque: "Dos áreas no pueden quedar encimadas: una taparía a la otra por completo sin que nadie lo note. Si la soltó sobre una sola área, las dos se intercambian; si cayó sobre varias, se va al primer hueco libre." },
      { sintoma: "El mapa sale vacío o con muy pocas horas", porque: "Solo entran los equipos marcados como que detienen la producción y con paro capturado. Si nadie anota cuánto estuvo parado el equipo al cerrar la orden, el área sale en blanco y parece sana." },
      { sintoma: "Un área muestra horas pero $0", porque: "No tiene tarifa por hora. Se captura en Catálogos → Ubicaciones. Ojo: la tarifa no es cuánto produce el área, es cuánto deja de ganar la empresa cuando algo de esa área detiene la producción." },
      { sintoma: "Dice «al menos» y no el total exacto", porque: "Faltan equipos por definir si detienen la línea, o áreas sin tarifa. El mensaje dice cuántos. Mientras falte, el número es un piso." },
      { sintoma: "La IA dice que no hay nada que explicar", porque: "Ese área no registró paros en el periodo, o los registró pero sin ninguna orden de trabajo que los explique. La IA lee texto: sin órdenes no hay qué leer." },
      { sintoma: "La explicación sale con confianza baja", porque: "Las órdenes se cerraron sin decir qué se hizo, o con un «listo» y nada más. Es preferible que lo admita a que invente una causa y mande a desarmar un equipo sano. Se arregla capturando la resolución al cerrar." },
    ],
  },

  "/reports": {
    titulo: "Reportes",
    que: "Los cortes de información para llevar a una junta o a un cierre de mes.",
    hacer: ["Elegir periodo (30 días, 90 días, 6 meses, 12 meses) y exportar", "Abrir cualquier indicador para ver su fórmula y los registros que lo forman", "Cortar la mezcla de mantenimiento por tipo de equipo, área, centro de costo o sitio, y medirla en órdenes, horas o costo"],
    flujo: [
      "Los indicadores son los mismos del Panel de control y del Diagnóstico IA: una sola fuente de cálculo.",
      "El periodo son días completos en la zona horaria de la empresa, hoy incluido.",
      "El costo cuenta órdenes TERMINADAS en el periodo; las canceladas no suman. El paro sale de los eventos de paro, y el planeado se reporta aparte: no resta disponibilidad.",
      "El costo de material por tipo de mantenimiento se atribuye a la ACTIVIDAD que consumió la refacción. Una orden preventiva que además atendió una falla reparte su material entre los dos tipos; lo que se cargó sin actividad se cuenta con el tipo de la orden y se muestra en su propia columna.",
      "«Preventivo, correctivo y predictivo» contesta en qué se está yendo el mantenimiento. Se agrupa por tipo de equipo, área, centro de costo o sitio, y se mide en órdenes, horas o costo: la misma mezcla vista de tres maneras. La barra es proporcional —de un golpe se ve si un grupo es mayormente preventivo o mayormente correctivo— y el tamaño real está en la tabla.",
      "Las órdenes de APOYO no entran en esa mezcla. Prestar manos a producción o mover un equipo consume horas y cuesta dinero, pero no es trabajo sobre la salud de una máquina: contarlas diría que los equipos fallan más de lo que fallan.",
      "Tampoco se reinterpreta el tipo: se usa el que la orden tiene. Un preventivo bien ejecutado no se vuelve falla aunque haya encontrado algo — eso metería un evento que nunca ocurrió.",
      "Lo que no tiene ese dato capturado sale como «Sin asignar», aparte y al final. No se reparte entre los demás, porque una regla inventada daría un número preciso y falso, ni se esconde, porque entonces la suma no cuadraría con el total del periodo.",
      "«Costo por centro de costo» es el mismo gasto en el idioma de su contabilidad, con mano de obra, refacciones y servicios separados. Para que caiga en su centro, cada equipo necesita el suyo en su ficha: la orden lo hereda al crearse.",
      "Los filtros viven en la dirección, así que el corte que arme se puede guardar en favoritos, mandar por mensaje y volver a abrir igual. Cambiar el periodo conserva el corte.",
    ],
  },

  "/indicadores": {
    titulo: "Cómo se calculan los indicadores",
    que: "Todos los indicadores con su definición y fórmula, y el detalle de cada uno: qué órdenes y paros cuentan, y los registros exactos que forman la cifra.",
    hacer: ["Cambiar el periodo", "Abrir un indicador y cada orden que aporta a su cifra"],
    flujo: [
      "Una orden cuenta como FALLA (MTBF, MTTR, tiempo de respuesta) solo si es correctiva, tiene código de falla en la orden o en una actividad, o trae una actividad de una solicitud clasificada como falla. Una preventiva o de seguridad sin falla registrada no cuenta. El detalle dice por qué cuenta cada una.",
      "El Pareto de códigos dice QUÉ falló —el síntoma— y «Por qué falla» dice el ORIGEN, agrupando por la familia de la causa raíz: práctica de mantenimiento, instalación, operación, desgaste normal, ambiente, causa externa o diseño. Cada familia trae qué se hace con ella, porque un pico en desgaste se ataca con reemplazo programado y uno en operación con capacitación.",
      "«Por qué falla» dice arriba sobre cuántas fallas está hablando. Las que se cerraron sin causa raíz no entran en el reparto y se cuentan aparte: un porcentaje calculado sobre la mitad de los datos es un número preciso y falso, y quien lo repita en una junta no tendría cómo saberlo.",
      "La suma del detalle es exactamente la cifra de la tarjeta (o su numerador, en porcentajes y promedios).",
      "«Con los datos de hoy» muestra la fórmula con los números reales del periodo.",
      "Completada es la fecha de finalización operativa; el cierre administrativo es aparte y no cambia el cumplimiento.",
    ],
    campos: [
      { nombre: "Estados de OT", explica: "Qué órdenes entran. Las canceladas nunca cuentan; una orden reabierta deja de contar como terminada hasta que se vuelva a completar." },
      { nombre: "Fecha que cuenta", explica: "Qué fecha decide si un registro cae en el periodo: creación, inicio, finalización o día compromiso." },
      { nombre: "A favor / En contra", explica: "En porcentajes, si ese registro suma al numerador (en fecha, planificado) o solo al denominador." },
    ],
  },

  "/catalogs": {
    titulo: "Catálogos",
    que: "Las listas que alimentan el resto del sistema: sitios, ubicaciones, almacenes, categorías, centros de costo, causas de falla, cuadrillas.",
    hacer: ["Dar de alta y editar cada catálogo", "Borrar los que no estén en uso"],
    campos: [
      {
        nombre: "Ubicaciones · Deja de ganar por hora parada",
        explica:
          "Lo que esa área deja de GANAR cada hora detenida: lo que dejaría de facturar menos el material que no se consumiría. Margen, no venta — un número de precio de venta se ve enorme y lo tumba el primero que pregunte si de verdad se perdió la venta. En cero significa «sin capturar», no «parar aquí es gratis».",
      },
    ],
    flujo: [
      "Un catálogo limpio es lo que después permite agrupar y comparar. Texto libre no se puede agrupar.",
      "Los proveedores tienen pantalla propia porque a ellos les cuelga información real.",
      "Los CENTROS DE COSTO son el eje contable, el único que no es de mantenimiento: sitio, ubicación y categoría dicen dónde está el equipo y qué es; el centro de costo dice a quién se le carga el gasto. Con él, el costo de mantenimiento sale agrupado como lo lleva su contabilidad y se puede llevar a una junta de presupuesto sin traducirlo a mano.",
      "No se inventan: se traen del ERP con la misma clave que usan allá, porque esa clave es lo que permite conciliar. Se importan como cualquier catálogo, y como cambian dos veces al año, un archivo al año alcanza.",
      "Un equipo pertenece a un centro de costo y sus órdenes lo heredan AL CREARSE. En la orden se puede cambiar, para el trabajo que paga otra área —una modificación que pide producción, un montaje que carga a un proyecto—.",
      "Se copia, no se consulta: si el año que viene mueve un equipo a otro centro, lo ya gastado se queda donde se gastó. Es a propósito. Si el histórico se recalculara, los reportes del año pasado cambiarían solos y quien lleva la contabilidad dejaría de confiar en el sistema.",
      "Un centro con gasto encima no se borra: se desactiva. Así deja de ofrecerse al capturar y lo histórico sigue explicándose.",
      "El resultado se ve en Reportes › Costo por centro de costo, con mano de obra, refacciones, servicios y el corte entre preventivo y correctivo. Las órdenes sin centro salen aparte, no se reparten entre los demás: repartirlas con una regla inventada daría un número preciso y falso, y esconderlas haría que la suma no cuadre con el total.",
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
      "Contarle al sistema qué hace su empresa, para que la IA piense mejor",
      "Configurar logotipo, color, proceso de compras y umbral de autorización",
      "Definir la jornada, los días laborables y los días que la empresa no trabaja",
      "Decidir cómo se arman las órdenes: si los días se cuentan corridos o hábiles, cuánto se puede adelantar un preventivo y desde dónde se recalcula",
      "Dar de alta usuarios y revisar la bitácora",
      "Encender los avisos al teléfono y activar cada aparato",
      "Elegir qué avisos le llegan y por dónde; y, si administra, cómo avisa la empresa: canales, horario, resúmenes, recordatorios y escalamiento",
      "Crear credenciales de API y webhooks para otros sistemas, y revisar el historial de entregas",
      "Poner a la mano las pantallas que usa a diario, hasta arriba de su menú",
      "Cerrar sus sesiones abiertas, generar ligas de contraseña y exportar su información",
    ],
    flujo: [
      "Los permisos van por rol. Cambiar el rol de alguien cambia lo que puede hacer en todas las pantallas.",
      "En «Jornada y calendario» se define de cuántas horas es un día de trabajo. De ahí sale si un día del calendario cabe y en qué fechas puede programar el programador.",
      "La capacidad se define por excepción: la organización fija el número general y solo quien trabaje distinto lleva el suyo.",
      "Los avisos al teléfono llevan DOS llaves: el administrador enciende la de la empresa, y además cada persona activa su propio aparato. Encender la de la empresa no activa a nadie.",
      "En «Seguridad y sesiones» puede cerrar su sesión en todos los dispositivos: la del teléfono que perdió deja de servir en ese momento, no cuando caduque. Cambiar una contraseña —la propia o una repuesta por administración— también cierra las demás sesiones de esa cuenta.",
      "En «Usuarios», el botón de liga genera una dirección para que la persona elija su propia contraseña. Vence en una hora, sirve una sola vez y solo se ve al generarla: si se cierra la caja, se genera otra.",
      "Exportar información pide permiso —propietario, administrador o supervisor— y cada exportación queda en la bitácora con quién la hizo.",
      "En «Avisos», los avisos obligatorios (seguridad, órdenes críticas, contraseñas) no se pueden apagar. Un aviso configurable tampoco se apaga cuando usted es el responsable directo de algo alto o la única persona que puede atenderlo.",
      "Los avisos no críticos respetan un horario (por omisión de 8 a 18, días laborables, en la zona de la empresa); los críticos salen a cualquier hora. Si el correo o el celular fallan, el aviso sigue en el centro de avisos y se reintenta.",
      "En «Integración», el secreto de una credencial o de un webhook se ve una sola vez, al crearlo. Revocar corta el acceso en la siguiente petición. Cada credencial y cada webhook son solo de esta empresa.",
      "Los permisos de una credencial se marcan uno por uno y lo que no marque no existe para ese sistema. Dos van juntos y conviene entenderlos: «compras:escribir» deja que su ERP informe el folio con que colocó la compra y registre la recepción de la mercancía —que entra al almacén con su kardex y su costo, igual que si la capturara una persona—, y «costos:leer» es lo que decide si además ve los montos. Una integración que nada más confirma folios no necesita ver precios.",
      "Las recepciones que manda una integración se ven en la ficha de la compra y en el kardex a nombre de esa integración, no en blanco: se sabe siempre si la entrada la capturó alguien o la mandó el ERP.",
      "En «Organización» hay cinco preguntas sobre su negocio. No son un trámite: alimentan el diagnóstico, los planes que propone la IA y las refacciones sugeridas. La más útil es «¿qué NO puede parar?».",
      "En «Lo que más uso» marca las pantallas que abre a diario y aparecen hasta arriba del menú, en el orden en que las eligió. Caben ocho: un acceso rápido de veinte renglones vuelve a ser un menú y no resuelve nada.",
      "Esos accesos son SUYOS, no de la empresa: el almacenista vive en existencias y requisiciones, y dirección en indicadores y reportes; no hay un acomodo que les sirva a los dos. Marcar los suyos no le cambia el menú a nadie más.",
      "Lo que NO cambian es cómo se llaman las cosas ni en qué grupo están. Es a propósito: de los nombres del menú salen los comandos de voz («llévame a almacén») y con esos nombres está escrita toda la ayuda. Si cada quien renombrara sus grupos, pedir una pantalla hablando dejaría de funcionarle y el soporte por teléfono no podría guiarlo.",
      "Si cambia de rol y pierde acceso a una pantalla anclada, deja de aparecer en su menú pero no se borra: si le devuelven el permiso, vuelve sola.",
      "En «Apariencia» escoge la voz con que lo escucha Y qué tanto le contesta hablando. «Concisa» dice lo que preguntó y deja el detalle escrito; «Completa» dice también el contexto que no pidió pero cambia la lectura. Las dos son suyas, no de la empresa: al que va manejando le sirve una y al que revisa sentado, la otra.",
    ],
    campos: [
      { nombre: "Pedir evidencia al completar órdenes de equipos críticos o de seguridad", explica: "Encendido, una orden de un equipo con criticidad A o de tipo seguridad no se puede completar sin al menos una foto o documento adjunto. Las demás no la piden. Apagado por omisión: exigir evidencia en todo llena el sistema de fotos de relleno." },
      { nombre: "Las órdenes preventivas las arma…", explica: "«El sistema, solo»: cuando a un equipo le toca mantenimiento, el programador junta en una orden todo lo que cae dentro del plazo. «El gestor»: el sistema no arma órdenes de calendario; usted decide en «Armar una orden» qué actividades van juntas. Las que se pasen de fecha sin orden se marcan atrasadas y quien puede armar órdenes recibe un aviso una vez al día. Los planes por medidor se siguen generando solos en los dos casos." },
      { nombre: "Los intervalos en días se cuentan…", explica: "«Corridos» cuenta días de calendario; «hábiles» cuenta días de trabajo, saltando los que su empresa no labora. Un cambio de aceite cada 15 días hecho el viernes 4 de septiembre cae el sábado 19 contando corridos, y el martes 22 contando hábiles en una planta de lunes a sábado. Cuente en hábiles si el mantenimiento va por desgaste —la máquina se gasta operando, no en el almanaque—. Los días laborables y los festivos son los de «Jornada y calendario», no una lista aparte. Aplica solo a los intervalos en días: una actividad semanal, mensual o trimestral se cuenta siempre por calendario. Cambiarlo no recalcula lo ya programado." },
      { nombre: "Cuando un preventivo se cierra tarde", explica: "Decide desde dónde se cuenta el siguiente. «Desde que se hizo» sirve cuando importa cuánto lleva operando el equipo —engrasado, cambios de aceite—; «desde la fecha en que tocaba» mantiene el calendario fijo, que es lo que necesita quien reporta cumplimiento contra un programa anual. En los dos casos no se salta ninguna actividad: cerrar tarde mueve la fecha, nunca se brinca el ciclo." },

      {
        nombre: "Avisos · Esta empresa manda avisos",
        explica:
          "Apagado, nadie recibe nada aunque tenga su teléfono activado. Apagarlo no borra los aparatos: vuelven a servir si se enciende otra vez.",
      },
      {
        nombre: "Avisos · Sus aparatos",
        explica:
          "Cada teléfono, tableta o computadora va por separado. Activarlo en el teléfono no lo activa en la tableta: así funciona el navegador, no es una falla.",
      },
    ],
    botones: [
      {
        nombre: "Activar en este aparato",
        explica:
          "Pide el permiso al sistema y registra este aparato. En iPhone solo aparece si MainTrack ya se agregó a la pantalla de inicio.",
      },
      {
        nombre: "Su negocio, en sus palabras",
        explica:
          "Cinco preguntas que la IA lee antes de analizar. No sustituyen a los datos: si escribe algo que sus órdenes de trabajo contradicen, mandan los datos y la IA se lo señala. Se marca solo cuando lleva más de un año sin actualizarse.",
      },
      {
        nombre: "Reponer contraseña (la llave, junto a cada usuario)",
        explica:
          "Le pone una contraseña nueva a esa persona cuando la olvidó. Usted se la dice y ella la cambia al entrar. Al propietario no se le puede reponer desde aquí —lo dejaría fuera de su propia empresa—: él la cambia en «Mi cuenta».",
      },
      {
        nombre: "Mandarme una prueba",
        explica:
          "Manda un aviso real a este aparato. Es la única forma de comprobar el camino completo: que diga «activado» solo significa que se guardó el registro.",
      },
    ],
    noPuedo: [
      {
        sintoma: "La IA me da respuestas genéricas, que no parecen de mi empresa",
        porque:
          "Probablemente falta el contexto del negocio, en la pestaña «Organización». Con solo el giro, la IA sabe la categoría pero no su operación: ni sus turnos, ni de qué equipo depende todo lo demás.",
      },
      {
        sintoma: "Alguien olvidó su contraseña y no puede entrar",
        porque:
          "No hay correo de recuperación. Un administrador se la repone desde Usuarios, con el botón de la llave junto a su nombre. Queda en la bitácora quién lo hizo, nunca cuál fue la contraseña.",
      },
      {
        sintoma: "No me llegan los avisos al iPhone",
        porque:
          "Casi siempre es que MainTrack no está agregado a la pantalla de inicio, o que se abrió desde Safari y no desde el icono. Apple solo entrega avisos a la aplicación instalada. Los pasos están en la pestaña Avisos.",
      },
      {
        sintoma: "Dice «Bloqueado» y el botón de activar no hace nada",
        porque:
          "El sistema operativo tiene negadas las notificaciones para MainTrack. Desde la página ya no se puede volver a preguntar: hay que permitirlas en los ajustes del aparato. La pantalla trae los pasos del aparato que esté usando.",
      },
      {
        sintoma: "Antes llegaban y de repente dejaron de llegar",
        porque:
          "Se borró el icono, se reinstaló la aplicación o se cambió de teléfono: la activación se pierde y hay que volver a activar. Si en la lista de aparatos aparece «intentos sin llegar», es eso.",
      },
      {
        sintoma: "Activé mi teléfono pero no recibo nada",
        porque:
          "Puede que su empresa tenga los avisos apagados. Mande una prueba: si están apagados, el mensaje se lo dice.",
      },
    ],
  },

  "/glossary": {
    titulo: "Glosario",
    que: "Qué significa cada término del sistema, y qué significa en SU planta con sus propios datos.",
    hacer: [
      "Consultar un término",
      "Preguntar qué significa ese término en su operación, con sus cifras",
    ],
    flujo: [
      "Si algo en otra pantalla no se entiende, probablemente esté aquí. Donde aparezcan dentro del sistema van subrayados con puntos: al tocarlos se abre la definición sin salir de la pantalla.",
      "Los términos que el sistema calcula traen SU cifra ahí mismo, con el periodo y la cuenta hecha con sus propios números —el MTBF dice «2,323 h» y debajo «(30,240 h − 39.1 h) ÷ 13 fallas»—. Es la misma cifra de Reportes, del mismo periodo: dos números distintos para lo mismo sería peor que no enseñar ninguno.",
      "Las cifras solo las ve quien puede abrir Indicadores. Para los demás la definición sale completa; lo que falta es el número, no el concepto.",
      "La definición es la misma para todos. Lo que no da ningún diccionario es el botón «Qué significa en mi planta»: ahí el sistema consulta SUS datos y le dice cómo va el suyo, qué lo está moviendo y en qué pantalla verlo. Preguntar por el MTBF, por ejemplo, contesta con su cifra, la fórmula con sus números, y los modos de falla que lo están hundiendo.",
      "Cuando el sistema NO calcula ese indicador, lo dice y explica qué haría falta, en vez de dar una cifra parecida. El OEE necesita datos de producción —rendimiento y calidad— que un sistema de mantenimiento no captura; presentar la disponibilidad como si fuera OEE sería engañoso.",
      "Usa la misma bolsa mensual que la ayuda con IA: es la misma conversación, anclada a un concepto en vez de a una pantalla.",
    ],
    botones: [
      { nombre: "Qué significa en mi planta", explica: "Abre una pregunta sobre ese término, contestada con sus datos reales. Trae tres sugerencias que sirven para cualquier término —qué significa aquí, dónde lo veo, qué hago con él— y acepta la pregunta que usted quiera escribir." },
    ],
    noPuedo: [
      { sintoma: "No veo el botón de preguntar", porque: "Su plan no incluye la ayuda con IA, o el servidor no la tiene configurada. El glosario sigue sirviendo como glosario." },
    ],
  },

  "/puesta-en-marcha": {
    titulo: "Puesta en marcha",
    que: "Los doce pasos para dejar la empresa operando, con lo que ya está bien, lo que falta y lo que hay que corregir.",
    hacer: [
      "Elegir cómo empezar: vacía, con la configuración recomendada o con datos de demostración",
      "Ver los pendientes en orden de importancia, con los registros concretos y cómo resolverlos",
      "Declarar que un módulo no se usará —almacén, compras, medidores— para que no se exija",
      "Quitar los datos de demostración, después de ver cuántos activos, órdenes, planes, refacciones, movimientos y proveedores se van y qué indicadores cambian",
      "Comenzar a operar cuando no haya bloqueos críticos",
    ],
    flujo: [
      "El avance cuenta solo lo que ya sirve. Un activo sin ubicación, un plan sin actividades o sin equipo asignado, un técnico desactivado o una refacción cuya existencia no cuadra NO suman, aunque existan.",
      "Cada paso tiene un estado: completo, en proceso, requiere corrección, opcional o no aplica. Los opcionales y los que no aplican no le bajan el porcentaje.",
      "El porcentaje es el mismo aquí, en el panel principal y en la consola del operador: sale de un solo cálculo.",
      "Lo que captura en cada pantalla se guarda ahí mismo. Puede ir y volver entre pasos, o dejarlo a medias, sin perder nada.",
      "Los datos de demostración llevan «[DEMO]» en el nombre. Mientras existan no se puede comenzar a operar, para que no se cuelen en los indicadores. Quitarlos borra solo lo que nadie usó.",
      "En planes se ven dos cosas: «Planes existentes: 6 de 6 correctos» dice si los que hay generarán órdenes; «Cobertura crítica: 5 de 6» dice cuántos equipos críticos tienen plan, y nombra los que faltan.",
      "Estado operativo: en configuración mientras haya bloqueos críticos, lista para operar cuando no los haya, y operando cuando alguien lo declare. Bloquean: datos generales, sitio, ubicación (si aplica), un técnico o supervisor, activos válidos, plan en los equipos críticos, reglas operativas y datos de demostración. Almacén, proveedores, medidores, tarifas y duplicados se avisan pero no bloquean.",
      "Comenzar a operar pasa por la misma revisión que muestra la pantalla, y queda en la bitácora con quién lo declaró y cuándo. No cambia el estado comercial de la cuenta.",
    ],
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
  // Se entra por una liga y sin sesion: no hay panel de ayuda donde mostrarla,
  // y la propia pantalla explica lo unico que hay que saber.
  "/restablecer",
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
