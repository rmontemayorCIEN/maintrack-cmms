/**
 * La guía de la empresa demostrativa: el recorrido guiado y las cinco
 * historias. Una sola fuente para la pantalla /demo, el recorrido y el guion
 * comercial (Docs/comercial). Sin base de datos: se usa en el navegador.
 *
 * Cada paso señala una pantalla real con los datos que siembra
 * lib/demo-comercial.ts; si la semilla cambia, esto se revisa con ella
 * (scripts/prueba-comercial.ts comprueba que los registros existan).
 */

export type PasoRecorrido = { titulo: string; texto: string; href: string; pantalla: string };

export const PASOS_RECORRIDO: PasoRecorrido[] = [
  { titulo: "Cada rol empieza en lo suyo", pantalla: "el inicio", href: "/dashboard", texto: "La dirección ve la situación crítica y cuatro indicadores; supervisión, el trabajo del día; el técnico, sus órdenes. Nadie busca: el sistema pone enfrente lo que toca." },
  { titulo: "El expediente de cada equipo", pantalla: "los activos", href: "/assets", texto: "Trece equipos con su criticidad y ubicación. Abra la llenadora LLN-101: historial, costo, fallas, planes y refacciones en una sola pantalla." },
  { titulo: "El trabajo, bajo control", pantalla: "las órdenes", href: "/work-orders", texto: "Cada orden con responsable, fecha y estado. Hay dos preventivos vencidos —uno es la caldera, crítica— y uno detenido por una refacción agotada." },
  { titulo: "El preventivo se programa solo", pantalla: "los planes", href: "/plans", texto: "Diez planes por calendario y por horas. El sistema genera las órdenes a tiempo y mide el cumplimiento." },
  { titulo: "Antes de que falle", pantalla: "las alertas", href: "/alerts", texto: "La temperatura del compresor viene subiendo desde que se limpió su enfriador. La alerta dice cuándo cruzará el límite crítico y deja crear la orden desde ahí." },
  { titulo: "Refacciones ligadas al trabajo", pantalla: "el almacén", href: "/inventory", texto: "El elemento separador del compresor está agotado y detiene un preventivo. El almacén lo marca bajo mínimo, con kardex y costo promedio." },
  { titulo: "De la requisición a la recepción", pantalla: "compras", href: "/compras", texto: "Una compra completa del mes pasado —cotización, orden, recepción— y otra que espera la firma de dirección." },
  { titulo: "Los números, al día", pantalla: "los indicadores", href: "/indicadores", texto: "Disponibilidad, cumplimiento, costo, MTBF y MTTR calculados por el sistema con lo que se registró, con su fórmula a la vista." },
  { titulo: "Dónde se pierde capacidad", pantalla: "Dónde para la planta", href: "/paros", texto: "Qué equipos y qué áreas detienen la línea, cuántas horas y cuánto cuesta. Aquí se decide dónde invertir primero." },
  { titulo: "Así arranca un cliente", pantalla: "la puesta en marcha", href: "/puesta-en-marcha", texto: "Los pasos para dejar una empresa lista para operar, con importación desde hojas de cálculo. Es lo que haría su equipo el primer día." },
];

export type Historia = {
  clave: string; titulo: string; rol: string; minutos: number;
  inicio: string; problema: string; pasos: string[]; resultado: string;
  /** Registros que conviene tener abiertos: se resuelven en la pantalla /demo. */
  registros: Array<{ etiqueta: string; tipo: "solicitud" | "activo" | "orden" | "refaccion" | "ruta"; clave: string }>;
};

export const HISTORIAS: Historia[] = [
  {
    clave: "correctiva", titulo: "Una falla, de principio a fin", rol: "Solicitante → Supervisión → Técnico → Supervisión → Dirección", minutos: 5,
    inicio: "El operador de llenado acaba de reportar que gotea producto por una válvula de la llenadora.",
    problema: "Si la fuga sigue, se desperdicia producto y la válvula puede terminar parando la línea.",
    pasos: [
      "Como solicitante (operador@): muestre el reporte SS-000001 en «Mis reportes» y cómo se hace uno desde el QR del equipo.",
      "Como supervisión (supervision@): en Solicitudes, apruebe SS-000001, conviértala en orden y asígnela a Luis Hernández.",
      "Como técnico (mecanico@, en el teléfono): acepte e inicie la orden, abra el expediente de LLN-101, marque la actividad, registre 1 h, cargue un kit de empaques KIT-VLL del almacén y tome una foto.",
      "Si faltara la refacción: pídala desde la orden con una requisición.",
      "Termine la orden con la solución, la falla y la causa (Fuga · Fin de vida útil del componente).",
      "Como supervisión: revise horas, costo, causa y evidencia, y cierre la orden.",
      "Abra LLN-101: la orden, su costo y la falla ya están en el historial; es la tercera fuga en válvulas en tres meses.",
    ],
    resultado: "El reporte se atendió en minutos, con responsable, costo y causa registrados; la recurrencia de fugas en la llenadora queda a la vista para decidir.",
    registros: [{ etiqueta: "Solicitud del operador", tipo: "solicitud", clave: "SS-000001" }, { etiqueta: "Llenadora LLN-101", tipo: "activo", clave: "LLN-101" }, { etiqueta: "Kit de empaques", tipo: "refaccion", clave: "KIT-VLL" }],
  },
  {
    clave: "preventiva", titulo: "El preventivo que se programa solo", rol: "Supervisión → Técnico", minutos: 4,
    inicio: "La llenadora, el equipo más crítico, tiene un plan semanal de lubricación y revisión de válvulas.",
    problema: "Sin plan, la lubricación depende de que alguien se acuerde; con el plan, el sistema genera la orden y mide si se cumplió.",
    pasos: [
      "Como supervisión: abra el plan «Lubricación y revisión de válvulas de la llenadora»: actividades, frecuencia, refacción y responsable.",
      "Muestre la orden que el sistema ya generó para los próximos días, asignada a Luis Hernández.",
      "Como técnico: ejecute la lista de verificación, capture la presión de llenado (1.8 a 2.4 bar) y termine.",
      "Como supervisión: cierre la orden.",
      "Vea el cumplimiento preventivo en el inicio y la siguiente fecha en el plan.",
    ],
    resultado: "El preventivo se generó, se ejecutó con lista de verificación y medición, y el cumplimiento se actualizó sin capturar nada aparte.",
    registros: [{ etiqueta: "Planes preventivos", tipo: "ruta", clave: "/plans" }, { etiqueta: "Llenadora LLN-101", tipo: "activo", clave: "LLN-101" }],
  },
  {
    clave: "condicion", titulo: "Por uso y por condición", rol: "Supervisión → Técnico", minutos: 5,
    inicio: "El compresor CMP-201 tiene un sensor de temperatura de descarga, y el montacargas un horómetro con servicio cada 250 horas.",
    problema: "La temperatura del compresor sube medio grado al día desde que se limpió su enfriador: ya pasó el límite de advertencia (95 °C) y va hacia el crítico (105 °C).",
    pasos: [
      "En Alertas: abra la alerta del compresor; muestre la tendencia y la fecha estimada del cruce crítico.",
      "Cree la orden desde la alerta y asígnela.",
      "Como técnico: registre la limpieza del enfriador y termine la orden.",
      "En Predictivo: registre una lectura de 83 °C y valide la normalización de la alerta.",
      "En Medidores: el montacargas MON-301 está a 18 h de su servicio; el sistema ya generó la orden por horas.",
    ],
    resultado: "El trabajo se hizo antes de la falla, por la condición real del equipo y no por calendario, y la alerta quedó cerrada con evidencia.",
    registros: [{ etiqueta: "Compresor CMP-201", tipo: "activo", clave: "CMP-201" }, { etiqueta: "Alertas", tipo: "ruta", clave: "/alerts" }, { etiqueta: "Medidores", tipo: "ruta", clave: "/meters" }],
  },
  {
    clave: "compras", titulo: "Inventario y compras", rol: "Compras → Dirección → Compras → Técnico", minutos: 5,
    inicio: "El cambio de aceite del compresor está detenido: no hay elemento separador aire-aceite (FIL-SEP).",
    problema: "Una refacción de 4,800 pesos detiene el servicio de un equipo crítico.",
    pasos: [
      "Como compras (compras@): en Almacén, FIL-SEP aparece agotado y bajo mínimo.",
      "Cree la requisición de compra de 2 piezas con proveedor Aire Comprimido Industrial Delta.",
      "Como dirección (direccion@): autorice la compra (también la RC-000002 de aceite, que ya espera su firma).",
      "Como compras: registre la cotización, elíjala, emita la orden de compra y reciba el material.",
      "Muestre el kardex: la entrada con su costo; y la orden del compresor, que ya puede continuar.",
    ],
    resultado: "La necesidad real (una orden detenida) se convirtió en compra autorizada y recibida; la existencia y el costo quedaron en el kardex y en la orden.",
    registros: [{ etiqueta: "Elemento separador", tipo: "refaccion", clave: "FIL-SEP" }, { etiqueta: "Compras", tipo: "ruta", clave: "/compras" }, { etiqueta: "Compresor CMP-201", tipo: "activo", clave: "CMP-201" }],
  },
  {
    clave: "direccion", titulo: "Lo que ve la dirección", rol: "Dirección", minutos: 4,
    inicio: "La directora de planta entra el lunes a primera hora.",
    problema: "Necesita saber qué está en riesgo y dónde se está perdiendo capacidad, sin pedir un reporte.",
    pasos: [
      "Como dirección (direccion@): el inicio muestra la situación crítica (refacción agotada que detiene trabajo), OT vencidas, cumplimiento, disponibilidad y costo.",
      "Abra las dos OT vencidas: una es la revisión de la caldera, equipo crítico.",
      "En Indicadores: tendencias y costo por equipo; la llenadora concentra las fallas.",
      "En Dónde para la planta: qué equipos detuvieron la línea y cuánto costó.",
      "Decisión: autorizar la compra pendiente y pedir que se revise la frecuencia de cambio de empaques de la llenadora.",
    ],
    resultado: "En cinco minutos, la dirección pasa de ver números a tomar dos decisiones concretas con evidencia.",
    registros: [{ etiqueta: "Indicadores", tipo: "ruta", clave: "/indicadores" }, { etiqueta: "Dónde para la planta", tipo: "ruta", clave: "/paros" }],
  },
];

export const ORDEN_RECOMENDADO = ["direccion", "correctiva", "compras", "condicion", "preventiva"];

export const PREGUNTAS_DEMO: Array<{ p: string; r: string }> = [
  { p: "¿Los datos son reales?", r: "No. La empresa demostrativa, sus personas, proveedores y cifras son de ejemplo. La historia de 90 días se generó con los mismos procesos del sistema, por eso los números cuadran." },
  { p: "¿Puedo capturar durante la demostración?", r: "Sí: todo funciona igual que en una cuenta real. Al terminar, restaure la demo para dejarla lista para la siguiente." },
  { p: "¿Qué no se puede hacer aquí?", r: "Cambiar el plan, crear credenciales de API o conectar avisos a otros sistemas: la demo no sale de sí misma." },
  { p: "¿Las fechas se ven viejas?", r: "Las fechas son relativas al día en que se restauró. Si la demo lleva semanas sin restaurarse, restáurela antes de presentar." },
  { p: "¿Qué rol uso?", r: "El que indique la historia. Las cuentas son dirección@, gerencia@, supervision@, mecanico@, electrico@, compras@, operador@ y calidad@, del dominio de la demo." },
];
