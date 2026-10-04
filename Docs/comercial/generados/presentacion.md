<!-- Generado por scripts/generar-documentos-comerciales.ts. No se edita a mano: cambie la fuente y vuelva a generar. -->

# MainTrack — presentación comercial

> 20 diapositivas, las mismas que se proyectan en **Guía de la demostración › Presentar al cliente** (`/demo/presentacion`, dentro de la empresa demostrativa), donde además abren las pantallas reales. Formato: una diapositiva por sección separada por `---` (compatible con Marp).

---

## 1. Anticipe fallas, controle el trabajo y descubra dónde se pierde capacidad productiva.

*Apertura*

MainTrack conecta activos, mantenimiento, inventario, condición y costos en una sola operación.

Todo lo que va a ver es MainTrack funcionando, con una planta de ejemplo y su historia de los últimos 90 días.

> **Quien presenta:** Diga cuánto va a durar (20 a 30 minutos) y que al final hay tiempo para preguntas.

---

## 2. Lo que cuesta atender el mantenimiento tarde

*Por qué*

Cinco problemas que aparecen en casi toda planta. Si reconoce tres, hay dinero sobre la mesa.

- **El mantenimiento se atiende tarde.** Se repara cuando el equipo ya se detuvo; el preventivo depende de la memoria de alguien. → *Trabajo reactivo → trabajo anticipado*: Planes preventivos por calendario y por medidor, Medidores y umbrales, Alertas por tendencia, Predictivo con vida útil remanente.
- **No hay visibilidad clara del trabajo.** Nadie sabe con certeza qué está pendiente, quién lo tiene ni qué se venció. → *Falta de control → control del trabajo*: Órdenes de trabajo con responsable, Calendario y backlog, Solicitudes y QR para reportar, Avisos y escalamiento.
- **Las refacciones no están conectadas con las necesidades reales.** Falta la pieza cuando se necesita y sobra la que nadie usa. → *Refacciones desconectadas → almacén ligado al trabajo*: Inventario con kardex y costo promedio, Requisiciones desde la orden, Compras y recepciones, Proveedores.
- **Los costos y las fallas están dispersos.** Mano de obra, refacciones y servicios viven en hojas distintas; nadie sabe cuánto cuesta cada equipo. → *Costos dispersos → costo por activo*: Mano de obra, materiales y servicios en cada orden, Costo por activo, Códigos de falla y causa raíz.
- **La dirección conoce los resultados cuando el daño ya ocurrió.** El reporte llega a fin de mes, cuando ya no se puede hacer nada. → *Información tardía → decisiones a tiempo*: Indicadores de disponibilidad y cumplimiento, Dónde para la planta, Avisos, Diagnóstico con evidencia.

> **Quien presenta:** Pregunte cuál de los cinco pesa más en su planta y amarre el resto de la demostración a ese.

---

## 3. Qué es MainTrack

*Por qué*

MainTrack es una plataforma de gestión y confiabilidad del mantenimiento que conecta activos, trabajo, inventario, condición y costos para anticipar fallas y mostrar dónde se está perdiendo capacidad productiva.

- **Activos:** Catálogo con ubicación, criticidad, expediente y QR.
- **Órdenes de trabajo:** Correctivas, preventivas y de mejora, con responsable, tiempo, material, evidencia y cierre validado.
- **Solicitudes:** Cualquier persona reporta una falla, también sin cuenta desde el QR del equipo.
- **Preventivo:** Planes por calendario o por medidor que generan sus órdenes.
- **Rondines:** Rutas de inspección con sus puntos y su QR: el rondín se recorre desde el teléfono y lo que se encuentra se convierte en orden sin capturarlo dos veces.
- **Medidores y predictivo:** Lecturas, umbrales, tendencias y vida útil remanente.
- **Almacén:** Existencias por almacén, kardex, costo promedio y mínimos, con una franja que dice de un vistazo qué familia está sufriendo y dónde está parado el dinero.
- **Compras:** Requisiciones, autorización, órdenes de compra, proveedores y recepción.
- **Indicadores y reportes:** Disponibilidad, cumplimiento, costos, MTBF y MTTR, backlog, y dónde para la planta: qué falla, por qué y cuánto cuesta cada paro.
- **Avisos:** En la campana y en el celular, sin costo por mensaje. Quien pide una refacción se entera cuando se autoriza y cuando llega.
- **Conversaciones y compromisos:** Se habla del registro, en el registro: cada orden, activo, solicitud, compra, plan, rondín, refacción y conjunto tiene su hilo, con menciones a la persona y avisos para quien pidió enterarse. Y lo que se acordó y no es una orden —cotizar, hablar con seguridad— queda anotado con responsable y fecha, y se cierra solo cuando se cumple.
- **Cumplimiento normativo:** Se contrata aparte, por $1,490 al mes. Las normas que su empresa debe cumplir, con el índice de qué plan, qué documento y qué registro responden a cada obligación, y el expediente listo para una inspección. La evidencia no se palomea: sale del trabajo que de verdad se hizo, con su fecha, su responsable y su foto. Le ayuda a organizar y conservar esa evidencia; no dictamina si cumple con la ley.
- **Registros propios:** Se contrata aparte, por $690 al mes. Las tablas que cada empresa lleva en Excel porque ni su ERP ni el CMMS las tienen —la bitácora del diésel, la entrega de equipo de protección, el análisis del agua, el seguimiento de sus contratos—, armadas desde un formato ya hecho y amarradas a sus equipos, su personal y sus proveedores: la columna «equipo» es el equipo, así que ese registro aparece después en el expediente de ese equipo.
- **Integración con su ERP:** API propia con permisos por llave, avisos firmados hacia sus sistemas y carga masiva del catálogo por archivo, con reversión. No hay conectores de fábrica: hay una puerta documentada y la abre su área de sistemas.

---

## 4. Y qué no es

*Por qué*

Decirlo temprano evita la decepción cara: esto no sustituye su ERP ni su contabilidad.

- No es un ERP ni un sistema contable: el ERP registra lo que pasó; MainTrack dirige, anticipa y documenta el mantenimiento, e intercambia información con el ERP cuando hace falta.
- No sustituye la nómina: registra las horas de mantenimiento para costear el trabajo, no para pagarlo.
- No sustituye el proceso financiero de compras: organiza requisiciones, órdenes de compra y recepciones de refacciones; el pago y la contabilidad siguen en su sistema.
- No es una plataforma IoT completa: recibe lecturas de medidores y sensores por captura, importación o API.
- No garantiza que no habrá fallas: ayuda a anticiparlas y a atenderlas antes y mejor.

> **Quien presenta:** Esta diapositiva vende. El cliente que ya vivió una promesa incumplida agradece que se marque el límite.

---

## 5. Una falla, de principio a fin

*El sistema*

El mismo camino que vamos a recorrer en el sistema, en el orden en que pasa en la planta.

1. **Alguien reporta:** El operador escanea el QR del equipo y describe la falla, con foto, sin necesidad de cuenta.
2. **Supervisión decide:** Revisa la solicitud, la convierte en orden de trabajo y la asigna a un técnico con fecha.
3. **El técnico ejecuta:** Desde su teléfono: actividades, tiempo, refacciones del almacén, lecturas y evidencia.
4. **Se valida y se cierra:** Supervisión revisa horas, costo, causa y evidencia antes de cerrar.
5. **Queda en el activo:** El historial, el costo y la falla alimentan los indicadores y el diagnóstico.

---

## 6. Cada quien ve lo suyo

*El sistema*

Nadie tiene que aprender el sistema completo: cada rol entra a su pantalla, con sus acciones.

- **Dirección:** Ve la situación crítica, la disponibilidad, el cumplimiento y el costo sin pedir un reporte.
- **Administración:** Configura la empresa, usuarios y catálogos, y revisa la calidad de los datos.
- **Supervisión:** Asigna, reprograma, da seguimiento y valida el trabajo cerrado.
- **Técnicos:** Tienen su trabajo del día en el teléfono y registran lo hecho sin papel.
- **Compras:** Recibe requisiciones con su porqué, compra y registra la recepción.
- **Solicitantes:** Reportan una falla en segundos y ven en qué va.

---

## 7. Lo que lo hace distinto

*El sistema*

Lo que no viene en cualquier sistema de órdenes de trabajo.

- **Dónde para la planta:** Muestra qué equipos y qué áreas detienen la producción, cuánto tiempo y cuánto cuesta cada paro.
- **Diagnóstico accionable:** Un diagnóstico periódico con hallazgos, la evidencia que los sostiene y qué hacer; los números los calcula el sistema, no la inteligencia artificial.
- **Expediente completo del activo:** Historial de órdenes, costos, fallas, lecturas, planes, refacciones y documentos de cada equipo en una sola pantalla.
- **Puesta en marcha guiada:** Pasos ordenados para dejar la empresa lista para operar, con importación desde hojas de cálculo.
- **Operación por rol:** Cada rol ve su inicio, su menú y sus acciones: dirección, administración, supervisión, técnicos, compras, solicitantes y consulta.
- **El técnico desde su teléfono:** La orden en el orden del trabajo, con fotos, lecturas, tiempo, material y el escaneo del QR del equipo.
- **Mantenimiento, inventario y compras conectados:** La orden pide la refacción, el almacén la surte o la requisición la compra, y el costo regresa a la orden.
- **Condición, medidores y alertas:** Lecturas y sensores que disparan trabajo antes de la falla.
- **Multiempresa:** Varios sitios en una misma cuenta y, para quien da servicio, varias empresas cliente separadas por completo.
- **El sistema le habla:** El parte del día cuenta en voz alta lo que hay que saber hoy, para oírlo camino a la planta; y se le puede preguntar hablando, como a un jefe de mantenimiento.
- **Se entiende antes de leerlo:** El inicio y el almacén abren con una franja donde cada cuadro es un equipo o una refacción: en un segundo se ve qué área está parada y qué familia está sufriendo.

---

## 8. Ahora, en el sistema real

*Casos*

Cinco historias completas sobre la empresa demostrativa. Cada una tiene botones para abrir la pantalla de la que se está hablando.

1. **Lo que ve la dirección · 4 min:** La directora de planta entra el lunes a primera hora.
2. **Una falla, de principio a fin · 5 min:** El operador de llenado acaba de reportar que gotea producto por una válvula de la llenadora.
3. **Inventario y compras · 5 min:** El cambio de aceite del compresor está detenido: no hay elemento separador aire-aceite (FIL-SEP).
4. **Por uso y por condición · 5 min:** El compresor CMP-201 tiene un sensor de temperatura de descarga, y el montacargas un horómetro con servicio cada 250 horas.
5. **El preventivo que se programa solo · 4 min:** La llenadora, el equipo más crítico, tiene un plan semanal de lubricación y revisión de válvulas.

> **Quien presenta:** Si el tiempo se acorta, escoja dos: «Lo que ve la dirección» y la que toque el problema que el cliente reconoció.

---

## 9. Lo que ve la dirección

*Casos · se muestra como: Dirección · 4 min*

La directora de planta entra el lunes a primera hora.

**El problema:** Necesita saber qué está en riesgo y dónde se está perdiendo capacidad, sin pedir un reporte.

1. **:** Como dirección (direccion@): el inicio muestra la situación crítica (refacción agotada que detiene trabajo), OT vencidas, cumplimiento, disponibilidad y costo.
2. **:** Abra las dos OT vencidas: una es la revisión de la caldera, equipo crítico.
3. **:** En Indicadores: tendencias y costo por equipo; la llenadora concentra las fallas.
4. **:** En Dónde para la planta: qué equipos detuvieron la línea y cuánto costó.
5. **:** Decisión: autorizar la compra pendiente y pedir que se revise la frecuencia de cambio de empaques de la llenadora.

**Lo que se explica al final:** En cinco minutos, la dirección pasa de ver números a tomar dos decisiones concretas con evidencia.

> **Quien presenta:** Historia 1 de 5. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.

---

## 10. Una falla, de principio a fin

*Casos · se muestra como: Solicitante → Supervisión → Técnico → Supervisión → Dirección · 5 min*

El operador de llenado acaba de reportar que gotea producto por una válvula de la llenadora.

**El problema:** Si la fuga sigue, se desperdicia producto y la válvula puede terminar parando la línea.

1. **:** Como solicitante (operador@): muestre el reporte SS-000001 en «Mis reportes» y cómo se hace uno desde el QR del equipo.
2. **:** Como supervisión (supervision@): en Solicitudes, apruebe SS-000001, conviértala en orden y asígnela a Luis Hernández.
3. **:** Como técnico (mecanico@, en el teléfono): acepte e inicie la orden, abra el expediente de LLN-101, marque la actividad, registre 1 h, cargue un kit de empaques KIT-VLL del almacén y tome una foto.
4. **:** Si faltara la refacción: pídala desde la orden con una requisición.
5. **:** Termine la orden con la solución, la falla y la causa (Fuga · Fin de vida útil del componente).
6. **:** Como supervisión: revise horas, costo, causa y evidencia, y cierre la orden.
7. **:** Abra LLN-101: la orden, su costo y la falla ya están en el historial; es la tercera fuga en válvulas en tres meses.

**Lo que se explica al final:** El reporte se atendió en minutos, con responsable, costo y causa registrados; la recurrencia de fugas en la llenadora queda a la vista para decidir.

> **Quien presenta:** Historia 2 de 5. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.

---

## 11. Inventario y compras

*Casos · se muestra como: Compras → Dirección → Compras → Técnico · 5 min*

El cambio de aceite del compresor está detenido: no hay elemento separador aire-aceite (FIL-SEP).

**El problema:** Una refacción de 4,800 pesos detiene el servicio de un equipo crítico.

1. **:** Como compras (compras@): en Almacén, FIL-SEP aparece agotado y bajo mínimo.
2. **:** Cree la requisición de compra de 2 piezas con proveedor Aire Comprimido Industrial Delta.
3. **:** Como dirección (direccion@): autorice la compra (también la RC-000002 de aceite, que ya espera su firma).
4. **:** Como compras: registre la cotización, elíjala, emita la orden de compra y reciba el material.
5. **:** Muestre el kardex: la entrada con su costo; y la orden del compresor, que ya puede continuar.

**Lo que se explica al final:** La necesidad real (una orden detenida) se convirtió en compra autorizada y recibida; la existencia y el costo quedaron en el kardex y en la orden.

> **Quien presenta:** Historia 3 de 5. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.

---

## 12. Por uso y por condición

*Casos · se muestra como: Supervisión → Técnico · 5 min*

El compresor CMP-201 tiene un sensor de temperatura de descarga, y el montacargas un horómetro con servicio cada 250 horas.

**El problema:** La temperatura del compresor sube medio grado al día desde que se limpió su enfriador: ya pasó el límite de advertencia (95 °C) y va hacia el crítico (105 °C).

1. **:** En Alertas: abra la alerta del compresor; muestre la tendencia y la fecha estimada del cruce crítico.
2. **:** Cree la orden desde la alerta y asígnela.
3. **:** Como técnico: registre la limpieza del enfriador y termine la orden.
4. **:** En Predictivo: registre una lectura de 83 °C y valide la normalización de la alerta.
5. **:** En Medidores: el montacargas MON-301 está a 18 h de su servicio; el sistema ya generó la orden por horas.

**Lo que se explica al final:** El trabajo se hizo antes de la falla, por la condición real del equipo y no por calendario, y la alerta quedó cerrada con evidencia.

> **Quien presenta:** Historia 4 de 5. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.

---

## 13. El preventivo que se programa solo

*Casos · se muestra como: Supervisión → Técnico · 4 min*

La llenadora, el equipo más crítico, tiene un plan semanal de lubricación y revisión de válvulas.

**El problema:** Sin plan, la lubricación depende de que alguien se acuerde; con el plan, el sistema genera la orden y mide si se cumplió.

1. **:** Como supervisión: abra el plan «Lubricación y revisión de válvulas de la llenadora»: actividades, frecuencia, refacción y responsable.
2. **:** Muestre la orden que el sistema ya generó para los próximos días, asignada a Luis Hernández.
3. **:** Como técnico: ejecute la lista de verificación, capture la presión de llenado (1.8 a 2.4 bar) y termine.
4. **:** Como supervisión: cierre la orden.
5. **:** Vea el cumplimiento preventivo en el inicio y la siguiente fecha en el plan.

**Lo que se explica al final:** El preventivo se generó, se ejecutó con lista de verificación y medición, y el cumplimiento se actualizó sin capturar nada aparte.

> **Quien presenta:** Historia 5 de 5. Los botones abren la pantalla real; regrese con «Atrás» del navegador o con la flecha izquierda.

---

## 14. Dónde entra la inteligencia artificial

*Cómo se trabaja*

Interpreta y redacta sobre sus propios datos. No inventa números ni decide por usted.

- **Brief del día, para escuchar:** Lo que la dirección necesita saber hoy, contado como lo diría una persona, para oírlo en el camino. Las cifras las calcula el sistema; la IA solo las hilvana, y se verifica que no haya agregado ninguna.
- **Diagnóstico semanal:** Cada semana la IA revisa indicadores, backlog, costos y calidad de captura, y entrega hallazgos con evidencia, acciones y una matriz FODA.
- **Asistente de cierre de orden:** Al cerrar una orden, propone código de falla, causa raiz y refacciones a partir de lo que escribio el técnico.
- **Generador de planes:** Redacta el plan completo de un activo: actividades, frecuencia, mano de obra por especialidad, refacciones y servicios externos.
- **Triage de solicitudes:** Lee lo que reporto alguien que no es de mantenimiento —con su foto— y propone título, prioridad, tipo y posibles duplicados.
- **Ayuda con IA:** Dudas sobre como usar el sistema, contestadas con la documentación y —cuando la pregunta es sobre su caso— con sus propios datos.

**La aritmética no es de la IA:** Disponibilidad, cumplimiento, costos, MTBF y MTTR los calcula el sistema con lo registrado, y cada indicador muestra su fórmula. La IA lee esos números ya calculados para explicar y proponer; nunca los suma ella.

Se cobra en operaciones al mes, no en tokens: Professional incluye 20 y Enterprise 80. El complemento «IA Avanzada» agrega 400 más y todas las funciones, por $990 MXN al mes. Dos cosas tienen su propia bolsa y no gastan las operaciones del plan: preguntar cómo se usa el sistema, y el parte del día. Son de uso diario, y racionarlas seria empujar a no usarlas.

Abrir en el sistema: Diagnóstico con IA (`/diagnostico`) · Consulta en lenguaje natural (`/consulta`)

---

## 15. El sistema habla, y también escucha

*Cómo se trabaja*

Lo que un director alcanza a revisar mientras maneja a la planta.

- **El parte del día:** En el inicio hay un botón que lo cuenta en voz alta: qué está parado, qué se venció, qué alerta hay y qué compra espera su firma. Con pausas, como lo diría el jefe de mantenimiento por teléfono. (En los dos planes.)
- **Prefiero preguntar y escuchar:** En «Pregunte a sus datos» se toca el micrófono y se pregunta hablando —«¿cuántas órdenes tengo vencidas?»—. El sistema consulta, contesta en voz alta y deja la respuesta escrita para copiarla. (Enterprise, para quien ve el panorama, con tope mensual por empresa.)

**Las cifras no las dice la IA:** Los totales, los conteos y las tendencias los calcula el sistema y se le entregan ya resueltos; la IA solo los hilvana para que suenen como los diría una persona. Antes de hablar se verifica que no haya agregado ninguna cifra que no estuviera.

Cada quien elige la voz que prefiere en Ajustes, y se puede probar antes de guardarla. Lo hablado pasa por los mismos permisos que lo escrito: nadie oye lo que no podría ver en pantalla.

Abrir en el sistema: El parte del día (`/dashboard`) · Preguntar hablando (`/consulta`)

> **Quien presenta:** Si hay bocina, reprodúzcalo. Es lo que más se recuerda de la demo, y no se explica: se oye.

---

## 16. Y lo que ya tenemos en el ERP

*Cómo se trabaja*

MainTrack no se conecta a su ERP: publica una API y recibe eventos. Su equipo de sistemas —o nosotros, con un agente instalado en su red— empuja y jala lo que haga falta. Es la única forma de integrar dos sistemas sin que la actualización de uno rompa al otro.

- **Lo que entra a MainTrack:** Solicitudes de trabajo, lecturas de medidor, condiciones de sensores, y los catálogos completos por archivo.
- **Lo que MainTrack entrega:** Consultas de activos, órdenes y existencias; avisos firmados en el momento; compras por colocar; recepciones y consumo.

- **Dynamics 365 · El más sencillo:** Business Central y Finance & Operations exponen OData y Dataverse, con avisos propios. La integración es cuestión de días de trabajo del lado del cliente, no de meses.
- **Oracle · Sencillo:** Fusion y NetSuite tienen servicios REST bien documentados. Técnicamente el más limpio de todos.
- **SAP · Técnicamente sí, políticamente despacio:** S/4HANA y Business One tienen servicios para esto. El obstáculo no es técnico: el área de SAP del cliente tiene su propio calendario, su consultor y su presupuesto. No se comprometen fechas que dependan de ellos.
- **CONTPAQi · Necesita un agente en su red:** Es el caso más frecuente en México y el más delicado: normalmente es software de escritorio sobre una base de datos en la red del cliente, sin nada a qué llamarle desde internet. Se resuelve con un programa chico instalado en su red que lee su base y empuja a la API de MainTrack —que ya está lista para recibir—.

**¿De quién es el almacén de refacciones?:** De esta respuesta depende todo lo demás. Si no se define, se descubre a medio camino y se rehace. Muchas plantas acaban partiéndolo: el almacén general en el ERP y el de mantenimiento en MainTrack, con traspasos entre los dos. Funciona bien y es la salida cuando el cliente no quiere ceder ninguno de los dos.

**El ERP sabe cuánto costó. No sabe por qué se volvió a romper.:** Un ERP registra que se compró un rodamiento y cuánto se pagó. No sabe que ese rodamiento fue a la bomba 3, que es la cuarta vez en ocho meses, que la causa raíz es desalineación, y que el paro cuesta más que la refacción. MainTrack sí. Integrarlos no es sincronizar almacenes: es devolverle al ERP el costo real de mantenimiento por activo, por línea y por centro de costo —mano de obra, refacciones, servicios externos y tiempo perdido— que hoy no tiene de dónde sacar.

Abrir en el sistema: Credenciales y webhooks (`/settings`)

> **Quien presenta:** Se enseña solo si preguntan por el ERP; si no, se salta. Cuando pregunten, no prometa un conector: lea la postura tal cual y pase a las preguntas para su área de sistemas. Lo que MainTrack no hace está en el documento de integraciones, y conviene decirlo: es lo que hace creíble el resto.

---

## 17. Su información, separada y respaldada

*Cómo se trabaja*

- Cada empresa ve solo su información: toda consulta se filtra por empresa.
- Acceso por rol: cada persona ve y hace solo lo de su función.
- Los archivos no son públicos; cada descarga se autoriza por unos minutos.
- Bitácora de auditoría: quién hizo qué y cuándo.
- Respaldo automático diario de la base de datos; se conservan 7. Recuperación a un punto en el tiempo dentro de los últimos 7 días.
- Opera en Google Cloud, región us-central1 (Estados Unidos).

- **Soporte:** Solicitud de soporte dentro de MainTrack (menú › Soporte). Lunes a viernes, de 9:00 a 18:00, hora del centro de México (Monterrey), días hábiles.
- **Tiempos:** Se comprometen tiempos de respuesta y de actualización por severidad, no tiempos de solución: dependen de la causa.
- **Disponibilidad:** MainTrack opera en Google Cloud con respaldos diarios. Por ahora no se compromete un porcentaje de disponibilidad: se informa cada incidente y su causa.

> **Quien presenta:** Aquí suele salir la pregunta de dónde viven los datos. La respuesta está en la diapositiva; no la adorne.

---

## 18. Cómo se arranca

*Cómo se trabaja*

La implementación no es automática: la puesta en marcha guía paso por paso, pero la información la aporta el cliente y la revisamos juntos. Con el catálogo de equipos en una hoja de cálculo, una planta empieza a registrar órdenes la primera semana.

1. **Acuerdo y alta:** Plan, documentos y fecha de arranque. Se crea la empresa y su responsable. — MainTrack con la dirección.
2. **Carga de información:** Equipos, ubicaciones, refacciones, planes y usuarios, con plantillas de importación. — El administrador del cliente.
3. **Capacitación:** Una sesión por rol: dirección, supervisión, técnicos, compras y solicitantes. — MainTrack.
4. **Operación acompañada:** Puesta en marcha al 100 %, revisión semanal de la calidad de los datos el primer mes. — Los dos.

Abrir en el sistema: Puesta en marcha (`/puesta-en-marcha`)

---

## 19. Planes y precios

*Cierre*

1 mes gratis, sin tarjeta y sin cargos.

- **Professional** — $2,990 MXN al mes. Para una planta completa que ya opera con indicadores. Hasta 1,000 activos y 50 usuarios.
  - Preventivo por calendario y por medidor
  - Órdenes de trabajo, solicitudes y reportes de falla
  - Almacén de refacciones, requisiciones y compras
  - Mantenimiento predictivo y monitoreo de condición
  - Alertas por tendencia y vida útil remanente
  - Avisos al celular, sin costo por mensaje
  - Reportes, indicadores y exportación
  - Bitácora de auditoría
  - API para integrar sistemas externos y sensores
  - 100 GB para fotos, videos y documentos
  - Diagnóstico semanal con inteligencia artificial
  - El parte del día, para escucharlo camino a la planta
  - El técnico cierra la orden dictándola, con el teléfono y las manos ocupadas
  - Decir a dónde ir y que el sistema lo lleve, desde cualquier pantalla
  - El inicio y el almacén con su franja: se ve el estado antes de leerlo
- **Enterprise** — $8,990 MXN al mes. Para grupos con varias plantas y volumen alto. Activos, usuarios y sitios sin límite.
  - Todo lo de Professional
  - Activos, usuarios y sitios sin límite
  - Monitoreo predictivo sin límite
  - Diagnóstico semanal y asistentes de IA (detalle en la comparación)
  - Consulta en lenguaje natural, y preguntarle hablando con respuesta en voz
  - Soporte con tiempos de respuesta prioritarios

- **Complemento de IA:** IA Avanzada: Todas las funciones de inteligencia artificial, con 400 operaciones al mes sobre cualquier plan de pago. Por $990 MXN al mes, sobre cualquier plan.
- **Cómo se cobra:** Mensual, en Pesos mexicanos (MXN). El cobro es manual: al inicio de cada mes se emite una nota de cobro con vencimiento a 15 días, y el pago se registra al confirmarse. La factura fiscal (CFDI) se emite aparte y no la genera MainTrack.
- **Impuestos:** Los impuestos aplicables se indican en la propuesta comercial.
- **Si no sigue:** Se puede cancelar en cualquier momento, con efecto al final del mes pagado. La cuenta queda en solo lectura y los datos se pueden exportar; se eliminan definitivamente solo a solicitud escrita.

> **Quien presenta:** No negocie el precio en la junta. Si lo piden, ofrezca empezar la prueba hoy y revisar el plan cuando se vea el volumen real.

---

## 20. Gracias

*Cierre*

Lo que sigue, si quiere verlo con sus equipos: le dejamos su cuenta con 1 mes gratis y arrancamos con su lista de equipos.

1. **Esta semana:** Nos manda su catálogo de equipos como lo tenga: hoja de cálculo, lista o fotos de placa.
2. **La siguiente:** Le entregamos la cuenta cargada y capacitamos por rol, una sesión cada uno.
3. **El primer mes:** Opera de verdad, acompañado: revisamos juntos la calidad de los datos cada semana.

¿Qué parte quiere ver otra vez?

> **Quien presenta:** Cierre pidiendo algo concreto y chico: la lista de equipos. Es el compromiso más fácil de cumplir y el que arranca todo.
