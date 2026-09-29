<!-- Generado por scripts/generar-documentos-comerciales.ts. No se edita a mano: cambie la fuente y vuelva a generar. -->

# MainTrack — todo lo que hace

> MainTrack es una plataforma de gestión y confiabilidad del mantenimiento que conecta activos, trabajo, inventario, condición y costos para anticipar fallas y mostrar dónde se está perdiendo capacidad productiva.

**40 pantallas** en 9 grupos · **24 funciones de inteligencia artificial** · **7 roles** · API con 11 permisos y 29 eventos.

Este documento dice lo que el sistema TIENE, no lo que cada empresa ya trae capturado: tener la función y tenerla en marcha son cosas distintas.

## Qué es

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

## Qué no es

- No es un ERP ni un sistema contable: el ERP registra lo que pasó; MainTrack dirige, anticipa y documenta el mantenimiento, e intercambia información con el ERP cuando hace falta.
- No sustituye la nómina: registra las horas de mantenimiento para costear el trabajo, no para pagarlo.
- No sustituye el proceso financiero de compras: organiza requisiciones, órdenes de compra y recepciones de refacciones; el pago y la contabilidad siguen en su sistema.
- No es una plataforma IoT completa: recibe lecturas de medidores y sensores por captura, importación o API.
- No garantiza que no habrá fallas: ayuda a anticiparlas y a atenderlas antes y mejor.

## Cada pantalla, y qué se hace en ella

### Cómo voy

**Inicio** — Lo que usted tiene que ver primero, según su rol: el dueño, el estado de la empresa; supervisión, el trabajo del día; el técnico, sus órdenes; compras, requisiciones y entregas; quien reporta, sus reportes.
  - Escuchar el parte del día antes de entrar a la planta, o en el camino
  - Usar las acciones rápidas de arriba para lo que hace todos los días
  - Entrar directo a cada pendiente desde su renglón
  - Ver de un vistazo cómo está cada área o sistema de la planta, y entrar a la que trae problema
  - Ver los resultados del periodo (dueño)
  - Actualizar los indicadores al momento, si acaba de cerrar trabajo

**Tablero** — Las órdenes por estado, para mover trabajo de una etapa a otra.
  - Arrastrar órdenes entre columnas para cambiar su estado
  - Acotar el tablero a una familia de equipo, a equipos concretos, a un responsable o a un tipo de mantenimiento

**Calendario** — Lo que está programado, lo que se proyecta y si de verdad cabe en los días que quedan.
  - Ver el mes, la semana con el trabajo de cada persona, o un solo día a detalle
  - Abrir cualquier día para ver todo lo que cae ahí
  - Filtrar por técnico, tipo de mantenimiento, familia de equipo o equipos concretos
  - Ver la carga de cada persona y qué días no alcanzan
  - Generar las órdenes de los planes que ya vencen
  - Pedirle a la IA que revise la semana y proponga qué mover

### Lo que llega

**Solicitudes de servicio** — Lo que reporta quien no es de mantenimiento: se revisa y se convierte en orden, o se descarta. Quien reporta ve aquí solo sus reportes («Mis reportes») y en qué van.
  - Levantar una solicitud a mano
  - Revisarla y convertirla en orden de trabajo
  - Analizar con IA lo que llegó por el portal público

**Puntos de reporte QR** — Códigos QR para pegar en máquinas y áreas. Quien los escanea reporta una falla sin cuenta ni contraseña.
  - Crear un punto para un lugar sin equipo registrado: un salón, un baño, un pasillo
  - Imprimir la hoja con todos los códigos, lista para recortar y pegar
  - Ver de cuál punto salen más reportes
  - Decidir qué muestra cada código a quien lo escanea

**Rondines** — El recorrido por la planta: lo que se ve, dónde y cuándo. Lo que hoy se queda en el pasillo o en una libreta que nadie vuelve a leer.
  - Empezar un recorrido, diciendo qué área va a caminar
  - Anotar cada parada dictando lo que ve
  - Escanear el código del punto, si lo tiene
  - Decir de qué equipo era cuando el sistema no lo puede saber solo

**Alertas** — Lo que el sistema detectó y necesita que alguien decida.
  - Revisar la alerta
  - Convertirla en orden de trabajo o darla por atendida
  - Validar la normalización de un punto que regresó a normal

### El trabajo

**Órdenes de trabajo** — Todo el trabajo de mantenimiento: lo que se planeó, lo que salió mal y lo que ya se hizo.
  - Crear una orden correctiva a mano
  - Filtrar por estado, tipo, prioridad o responsable
  - Acomodar columnas, agrupar hasta en tres niveles y guardar su vista
  - Quitar horas, refacciones o servicios cargados por error, mientras la orden no esté cerrada

**Armar una orden** — Junta en una sola orden todo lo que se le debe a un equipo: el preventivo que ya toca, las fallas que le reportaron y lo que quedó trabado la vez pasada.
  - Elegir el equipo y ver los tres orígenes juntos
  - Marcar actividad por actividad qué va en esta orden —lo que no marque queda para otra—
  - Elegir qué tan adelante mirar: esta semana, este mes, los próximos 30 días
  - Asignar responsable, fecha y prioridad

**Qué falta para cerrar** — El estado de cada orden ya trabajada, bloque por bloque, para saber cuáles se pueden cerrar sin abrirlas una por una.
  - Ver de un golpe cuáles órdenes están listas para cerrar
  - Tocar «Listas para cerrar» para dejar en la lista solo esas
  - Leer qué le falta exactamente a cada una, en palabras
  - Agrupar por responsable para ver qué trae cada quien sin cerrar
  - Ordenar por lo que lleva más tiempo esperando validación

**Trabajo pendiente** — Todo el trabajo que falta: órdenes abiertas y actividades que no se pudieron hacer, separadas por lo que les impide avanzar.
  - Tocar un recuadro de arriba para ver solo esa categoría, y tocarlo otra vez para quitar el filtro
  - Reagrupar por equipo, responsable, motivo u origen, cuando la pregunta no es «qué lo detiene» sino «de quién es» o «de qué máquina es»
  - Ver de un vistazo cuántas órdenes están en espera, vencidas, sin responsable, sin programar o a tiempo, y cuántas actividades no se realizaron
  - Leer por cada renglón su origen, activo, prioridad, horas estimadas, motivo, responsable, antigüedad y la próxima acción
  - Ver qué quedó pendiente en cada equipo y por qué
  - Saber cuáles ya se pueden hacer porque la refacción que faltaba ya llegó
  - Ver cuánto lleva esperando cada actividad

**Personal** — Cómo está repartido el trabajo, en qué se va el tiempo y qué está trabando la operación.
  - Ver qué trae asignado cada quien y su carga de los próximos 15 días
  - Comparar el tiempo estimado contra el realmente aplicado
  - Ver en qué equipos trabaja cada persona
  - Pedirle a la IA que revise cómo está trabajando el equipo

### Sus registros

**Registros propios** — Las tablas que su empresa arma para lo que lleva aparte porque ni su ERP ni MainTrack lo tienen: el diésel que se carga a cada equipo, el equipo de protección que se entrega a cada persona, el análisis del agua de la torre, la gestión administrativa de sus contratos. Lo que hoy vive en un Excel que solo una persona sabe abrir.
  - Capturar en las tablas que su empresa armó
  - Filtrar, agrupar, ordenar y exportar lo capturado
  - Ver la suma de las columnas de cantidad e importe
  - Armar una tabla nueva desde un formato ya hecho, o en blanco (administración)
  - Agregar columnas a una tabla que ya tiene datos, sin perder nada

### Equipos y planes

**Activos / Equipos** — El inventario de equipos mantenibles: qué hay, dónde está, qué tan crítico es y qué cuesta mantenerlo.
  - Dar de alta equipos a mano o levantarlos con IA a partir de una descripción o fotos
  - Elegir qué columnas ver, en qué orden, y agrupar hasta en tres niveles
  - Eliminar un activo capturado por error

**Escanear QR** — Leer con la cámara el código QR de un equipo, de un punto de reporte o de una orden, y abrir lo que corresponde con su usuario.
  - Tocar «Abrir cámara y escanear» y apuntar al código
  - Escribir la clave del equipo o un folio si no hay cámara o el código está dañado

**Medidores** — Las lecturas de horas, kilómetros o ciclos que disparan mantenimiento por uso.
  - Capturar lecturas, con fecha pasada si hace falta
  - Registrar el reinicio o la sustitución de un medidor
  - Corregir o anular una lectura mal capturada (supervisor en adelante)
  - Configurar el tipo de medidor y su uso máximo por día

**Planes preventivos** — Las rutinas que se repiten: qué se le hace a cada equipo, cada cuánto, con qué refacciones y cuánto cuesta.
  - Dar de alta un plan con sus actividades, refacciones, mano de obra y servicios
  - Generarlo con IA a partir del equipo, o completar con IA lo que consume un plan que ya existe
  - Ejecutar el programador para que nazcan las órdenes

**Conjuntos** — Sus líneas (o sistemas, servicios, rutas) dibujadas como de verdad están, con el estado vivo de cada equipo, lo que costaron y lo que traen pendiente.
  - Agrupar los equipos que dependen unos de otros, aunque estén en áreas distintas
  - Ver de un vistazo si lo que alguien cuida está completo o tiene algo abajo
  - Saber qué equipos no están en ningún grupo todavía
  - Poner nombre y responsable a cada uno
  - Entrar a uno y dibujarlo: acomodar sus equipos como de verdad están
  - Ver de reojo cada mapa en su miniatura, con la misma vista que el mapa: cómo está ahora, lo que costó o lo que trae pendiente
  - Filtrar los mapas por sitio (la planta), por clasificación (Producción, Servicios auxiliares…) y por categoría de equipo (compresores, bombas…), para enfocarse en una parte de una instalación grande
  - Volver de un toque al último mapa que abrió, y desde la ficha de un equipo, verlo en el mapa de cada línea donde está

**Predictivo** — Sensores y tendencias que avisan antes de que algo falle.
  - Registrar sensores y sus lecturas
  - Ver qué variables se están saliendo de rango

### Almacén y compras

**Almacén** — Qué hay, en qué almacén, cuánto vale y qué está por acabarse.
  - Ver de un vistazo qué familia está sufriendo, en la franja de arriba
  - Registrar entradas, salidas y ajustes
  - Ver la existencia de un almacén específico con el selector de arriba
  - Entrar al kardex, a los traspasos, a los conteos y a los indicadores

**Herramientas** — Lo que sale del almacén y regresa: quién la tiene, desde cuándo, en qué estado salió y en qué estado volvió. Y cuando algo no vuelve, cuánto costó y a quién se le quedó.
  - Prestar una herramienta a alguien, con su propósito y su estado de salida
  - Recibirla de vuelta, anotando cómo regresó
  - Dar de baja lo que se perdió, se rompió o terminó su vida útil
  - Ver quién trae qué, y qué lleva demasiado tiempo fuera
  - Ver qué se está perdiendo y cuánto cuesta (solo quien ve costos)

**Requisiciones** — Lo que mantenimiento le pide al almacén, y el vale con el que se entrega.
  - Pedir material contra una orden de trabajo o un activo
  - Surtir completo o en partes, registrando a quién se entrega
  - Recibir de vuelta lo que no se usó

**Compras** — Lo que el almacén no tuvo y hay que adquirir, con quién lo autorizó y qué llegó.
  - Solicitar una compra, casi siempre desde una requisición que no se pudo surtir
  - Autorizar o rechazar con motivo
  - Anotar la orden de compra y recibir la mercancía

**Qué hay que comprar** — Lo que se va a acabar antes de que alcance a llegar, para pedirlo a tiempo en vez de cuando ya falta.
  - Ver qué urge, ordenado por lo que ya va tarde
  - Cambiar el horizonte: 30, 90 o 180 días
  - Abrir cualquier renglón para ver de dónde salió la cifra
  - Desmarcar lo que no quiera y mandar el resto a una requisición de compra

**Proveedores** — Quién surte las refacciones y quién presta los servicios externos, con lo que cada uno representa.
  - Dar de alta y editar proveedores con sus condiciones
  - Ver cuántas refacciones surte cada uno y cuántas están bajo mínimo
  - Ver el gasto acumulado y el último servicio

**Garantías y vigencias** — Los papeles que se vencen y que alguien tiene que renovar a tiempo: garantías de equipo, pólizas de seguro, fianzas, contratos de servicio, calibraciones de instrumentos, permisos de operación, licencias del personal y certificados. Lo que en casi toda planta vive en una carpeta o en un Excel que solo una persona sabe abrir.
  - Registrar un documento con su vigencia y a quién se le reclama
  - Ver de un golpe qué está vencido y qué se vence pronto
  - Anotar qué cubre y qué no, para cuando llegue la falla
  - Cancelar uno que dejó de aplicar, sin borrar la historia

### Cómo me fue

**Indicadores** — Todos los indicadores con su definición y fórmula, y el detalle de cada uno: qué órdenes y paros cuentan, y los registros exactos que forman la cifra.
  - Cambiar el periodo
  - Abrir un indicador y cada orden que aporta a su cifra

**Presupuestos** — Cuánto se puede gastar en cada centro de costo, contra lo que de verdad se lleva gastado.
  - Capturar el presupuesto de cada centro, mes por mes
  - Ver cuánto se lleva ejercido y cuánto queda disponible
  - Cambiar de mes o ver el año completo
  - Ver en qué se fue: mano de obra, refacciones, servicios y otros

**Cumplimiento normativo** — Las normas que su empresa debe cumplir, y con qué las está cumpliendo. No es un módulo aparte del trabajo: es el índice que dice qué plan, qué documento y qué registro de los que ya tiene responden a cada obligación, y si están al corriente.
  - Elegir las normas que le aplican, de las que le proponemos por su giro
  - Dar de alta una norma propia: un requisito de su corporativo o de su cliente
  - Decir con qué se cumple cada obligación, amarrándola a lo que ya existe
  - Marcar lo que no le aplica, con su razón
  - Colgarle a la norma su publicación oficial, su guía o el manual del que depende: archivos y enlaces
  - Sacar el expediente de una norma para una inspección

**Dónde para la planta** — Qué áreas detuvieron la producción, cuánto costó y si va mejorando.
  - Ver de un vistazo qué área concentra el daño
  - Saber cuánto costó en dinero, no solo en horas
  - Comparar contra el periodo anterior del mismo largo
  - Simular cuánto bajaría la pérdida sin un equipo

**Reportes** — Los cortes de información para llevar a una junta o a un cierre de mes.
  - Elegir periodo (30 días, 90 días, 6 meses, 12 meses) y exportar
  - Abrir cualquier indicador para ver su fórmula y los registros que lo forman
  - Cortar la mezcla de mantenimiento por tipo de equipo, área, centro de costo o sitio, y medirla en órdenes, horas o costo

**Pregunte a sus datos** — Preguntas en español sobre su propia operación, contestadas con sus datos reales.
  - Preguntar cosas como «¿qué equipo me costó más este trimestre?» o «¿qué refacciones se acabaron?»
  - Escuchar la respuesta, con el botón de bocina de cada una
  - Copiar la respuesta, para pegarla en un correo o en una junta
  - Cambiar al modo hablado: toque el micrófono, haga su pregunta y el sistema contesta en voz alta (plan Enterprise)

**Diagnóstico IA** — Un análisis del estado de la operación, con fortalezas, riesgos y qué atender primero.
  - Generar el diagnóstico del periodo
  - Revisar las áreas de oportunidad

### Configuración

**Puesta en marcha** — Los doce pasos para dejar la empresa operando, con lo que ya está bien, lo que falta y lo que hay que corregir.
  - Elegir cómo empezar: vacía, con la configuración recomendada o con datos de demostración
  - Ver los pendientes en orden de importancia, con los registros concretos y cómo resolverlos
  - Declarar que un módulo no se usará —almacén, compras, medidores— para que no se exija
  - Quitar los datos de demostración, después de ver cuántos activos, órdenes, planes, refacciones, movimientos y proveedores se van y qué indicadores cambian
  - Comenzar a operar cuando no haya bloqueos críticos

**Catálogos** — Las listas que alimentan el resto del sistema: sitios, ubicaciones, almacenes, categorías, centros de costo, causas de falla, cuadrillas.
  - Dar de alta y editar cada catálogo
  - Borrar los que no estén en uso

**Armar un registro** — Donde se define una tabla nueva: cómo se llama, para qué es, qué columnas tiene, quién captura y quién la ve.
  - Arrancar de un formato ya hecho y ajustarlo
  - Empezar en blanco cuando ninguno se parece
  - Elegir el tipo de cada columna, incluidas las que apuntan a sus datos
  - Decidir quién captura y quién ve, que son cosas distintas

**Importar datos** — Cargar sitios, activos, usuarios, almacenes, medidores y lecturas, refacciones y existencias, planes, proveedores y catálogos desde Excel (.xlsx) o CSV, con vista previa y reversión.
  - Bajar la plantilla en Excel o en CSV, llenarla y subirla: las dos se leen con las mismas reglas
  - Revisar la vista previa: qué es nuevo, qué ya existe, qué parece duplicado y qué tiene error
  - Decidir los duplicados: omitirlos, actualizar los existentes o crear uno que se parece pero es distinto
  - Ver cada error con su fila, columna, el valor que traía, el problema y cómo corregirlo; descargar ese detalle, corregir y volver a validar
  - Revertir una importación desde el historial

**Ajustes** — Su cuenta, la organización, los usuarios, el plan y la bitácora.
  - Cambiar tamaño de letra y densidad —eso es suyo, no de la empresa—
  - Contarle al sistema qué hace su empresa, para que la IA piense mejor
  - Configurar logotipo, color, proceso de compras y umbral de autorización
  - Definir la jornada, los días laborables y los días que la empresa no trabaja
  - Decidir cómo se arman las órdenes: si los días se cuentan corridos o hábiles, cuánto se puede adelantar un preventivo y desde dónde se recalcula
  - Dar de alta usuarios y revisar la bitácora
  - Encender los avisos al teléfono y activar cada aparato
  - Elegir qué avisos le llegan y por dónde; y, si administra, cómo avisa la empresa: canales, horario, resúmenes, recordatorios y escalamiento
  - Crear credenciales de API y webhooks para otros sistemas, y revisar el historial de entregas
  - Poner a la mano las pantallas que usa a diario, hasta arriba de su menú
  - Plegar la columna del menú con el botón de junto al logotipo, para ganar ancho en el tablero, el calendario o los reportes
  - Cerrar sus sesiones abiertas, generar ligas de contraseña y exportar su información

### Ayuda

**Soporte** — Pedir ayuda al equipo de MainTrack y ver en qué va. Es el canal de soporte: no hace falta correo ni teléfono.
  - Escribir qué intentaba hacer y qué pasó, elegir la severidad y enviar
  - Ver el folio, el estado y la respuesta
  - Agregar información, subir la severidad si urge más o confirmar que quedó resuelto

**Glosario** — Qué significa cada término del sistema, y qué significa en SU planta con sus propios datos.
  - Consultar un término
  - Preguntar qué significa ese término en su operación, con sus cifras

## Cuántas pantallas ve cada quien

Nadie ve todo. El menú se arma según el rol, así que un solicitante entra a un sistema de seis pantallas y un técnico a uno de veinte: no hay que enseñarles lo que no van a usar.

| Rol | Pantallas |
|---|---|
| Propietario | 40 |
| Administración | 40 |
| Supervisión | 36 |
| Técnico | 23 |
| Compras | 12 |
| Solicitante | 7 |
| Consulta | 24 |

Además, cada persona puede poner sus pantallas de diario hasta arriba de su menú, sin cambiarle el menú a nadie más.

## Lo que hace la inteligencia artificial

Interpreta y redacta sobre los datos de la empresa. **No hace la aritmética**: disponibilidad, cumplimiento, costos, MTBF y MTTR los calcula el sistema y cada indicador muestra su fórmula; la IA lee esos números ya resueltos.

| Función | Qué hace | Operaciones |
|---|---|---|
| Revisar las fotos del rondín | Mira las fotos del recorrido por la planta y señala lo que un jefe de mantenimiento notaría al pasar: fugas, guardas faltantes, pasillos obstruidos, deterioro. Propone; nada se crea solo, y cada hallazgo dice en qué se basa para que usted lo pueda contradecir mirando la foto. | 2 |
| Navegar hablando | Decir a dónde quiere ir y que el sistema lo lleve: «llévame a las órdenes vencidas», «ábreme el almacén», «enséñame la bomba 3». Lo que se dice se interpreta con reglas, no con el modelo: es instantáneo y solo cuesta oír. | 1 |
| Dictado del técnico | El técnico cierra la orden hablándole al teléfono, en el piso y con las manos sucias, en vez de escribir. Lo que dicta se transcribe y queda en el texto del cierre, que es de donde sale todo lo demás. | 1 |
| Brief del día, para escuchar | Lo que la dirección necesita saber hoy, contado como lo diría una persona, para oírlo en el camino. Las cifras las calcula el sistema; la IA solo las hilvana, y se verifica que no haya agregado ninguna. | 1 |
| Diagnóstico semanal | Cada semana la IA revisa indicadores, backlog, costos y calidad de captura, y entrega hallazgos con evidencia, acciones y una matriz FODA. | 1 |
| Asistente de cierre de orden | Al cerrar una orden, propone código de falla, causa raiz y refacciones a partir de lo que escribio el técnico. | 1 |
| Generador de planes | Redacta el plan completo de un activo: actividades, frecuencia, mano de obra por especialidad, refacciones y servicios externos. | 2 |
| Refacciones sugeridas por equipo | Propone que refacciones conviene tener en almacén para un equipo, sobre todo cuando aun no hay consumo del cual deducirlo. | 1 |
| Levantamiento de inventario | Entrevista sobre la instalación y propone el inventario de activos completo, agrupado por sistema, listo para revisar y dar de alta. | 3 |
| Lectura del documento de una norma | Lee el PDF que el cliente colgo de una norma —su publicacion oficial o su guia— y propone lo que exige, cada obligacion con la cita textual del renglon que la sustenta. No usa lo que el modelo recuerde de la norma: si no puede citar, no propone. | 4 |
| Reconocimiento por fotografia | De la foto de un cuarto de máquinas o un área identifica los equipos que se ven, para completar el levantamiento con lo que la entrevista no alcanzo. | 1 |
| Lectura de placa | De la fotografia de la placa de un equipo extrae fabricante, modelo, serie y datos técnicos, y avisa si la foto no sirve. | 1 |
| Revisión de configuración | Revisa como quedo armada la cuenta y senala lo que una lista de verificacion no puede ver: cobertura desbalanceada, datos que no se conectan, escalas que no cuadran. | 1 |
| Procedimiento de correctiva | Prepara el trabajo de una falla: como asegurar el equipo, los pasos en orden, que medir y contra que, y que refacciones del catalogo llevar. | 2 |
| Revisar la semana | Lee la carga real de la semana y propone que mover y en que orden: quien esta saturado, que se puede juntar en una sola visita y que no debe recorrerse. | 2 |
| Equivalencias sugeridas | Lee el catalogo y propone que refacciones son la misma pieza de otra marca o pueden sustituirse. Propone; usted decide cual se registra. | 2 |
| Revisar al equipo | Lee como esta repartido el trabajo y senala lo que un numero no dice: carga desbalanceada, conocimiento concentrado en una persona, estimaciones que no sirven y trabas que no son de la gente. | 2 |
| Por donde empezar los preventivos | Lee el catalogo de equipos sin plan y propone en que orden armar el programa preventivo: que familia primero, por que, y como estructurar cada una. | 2 |
| Limpieza del catálogo | Revisa las refacciones que parecen duplicadas y distingue las que son la misma pieza de las que solo se llaman parecido. | 2 |
| Por qué para esta área | Lee las órdenes de un área y le explica al dueño por qué se detuvo, en pesos: qué conecta a los equipos que fallaron y si eso coincide con lo que él dice que le duele. | 2 |
| Análisis de recurrencia | Lee el historial de fallas de un equipo y explica el patron: que las une y si se esta tratando el sintoma en vez de la causa. | 2 |
| Triage de solicitudes | Lee lo que reporto alguien que no es de mantenimiento —con su foto— y propone título, prioridad, tipo y posibles duplicados. | 1 |
| Ayuda con IA | Dudas sobre como usar el sistema, contestadas con la documentación y —cuando la pregunta es sobre su caso— con sus propios datos. | 1 |
| Consulta en lenguaje natural | Preguntas como «cuanto lleve gastado en el compresor este año» respondidas sobre sus propios datos. | 1 |

## Cómo se conecta con otros sistemas

- **API propia, con versión:** Rutas bajo /api/v1 para consultar activos, ubicaciones, órdenes, inventario y el estado general, y para recibir solicitudes, lecturas de medidores, condiciones de sensores y eventos. El índice de la API se consulta en línea y dice qué rutas hay y qué permiso pide cada una.
- **Credenciales que da el cliente, no nosotros:** En Configuración › Integración la empresa crea sus propias llaves y elige de 11 permisos qué puede hacer cada una. El secreto se muestra una sola vez; en la base solo queda su huella. Se revoca o se rota sin llamarnos.
- **La empresa sale de la llave:** Nunca de un parámetro de la petición. Un sistema externo no puede leer los datos de otro cliente ni por error ni a propósito; pedirlos responde «no encontrado», igual que pedir algo que no existe.
- **Reintentar no duplica:** Las rutas que escriben aceptan una clave de idempotencia: si la red se cae a media petición y el ERP reintenta, no se crea un segundo registro; se devuelve la misma respuesta de la primera vez.
- **Webhooks firmados, 29 eventos:** MainTrack avisa al sistema del cliente cuando pasa algo: se abrió una orden crítica, se venció un preventivo, una refacción quedó bajo mínimo, hay una compra por autorizar, llegó la mercancía. Cada webhook tiene su secreto de firma, con reintentos, historial de entregas y suspensión automática si el destino deja de responder.
- **Bitácora de todo lo que entra:** Quién llamó, qué ruta, cuándo y con qué resultado —incluidos los intentos rechazados—. Cuando algo no llegó, se puede decir de qué lado se quedó sin discutirlo.
- **Carga masiva por archivo:** Para arrancar, o para lo que no valga la pena automatizar: el catálogo completo entra por archivo —sitios y ubicaciones, activos, medidores y sus lecturas, refacciones y existencias, proveedores, planes y catálogos de falla—. Se valida en seco antes de escribir, se confirma, y si algo salió mal el lote completo se revierte.
- **Límites para que una integración no tire el sistema:** 120 peticiones por minuto por llave y 600 por empresa; las lecturas tienen 300, porque una pasarela de sensores manda en ráfagas. Cada empresa tiene su propio contador: nadie consume el de otro.

El detalle está en `integraciones.md`, y la referencia técnica en `Docs/api-v1.md`.

## Cómo entra la información al arrancar

- **Sitios** — Plantas, edificios, sucursales o centros de trabajo. Impórtelos primero: los activos y las ubicaciones dependen de ellos.
- **Ubicaciones** — Áreas, líneas, cuartos o niveles dentro de un sitio.
- **Usuarios y responsables** — Su equipo de trabajo con su rol, puesto y tarifa. No se importan contraseñas: cada persona elige la suya con una liga de un solo uso que se genera en Usuarios.
- **Almacenes** — Los almacenes o bodegas de refacciones, con su sitio y su responsable.
- **Categorías de activo** — Familias de equipo para agrupar y filtrar.
- **Centros de costo** — El eje contable: la clave con la que su empresa lleva el gasto. Tráigalos de su ERP tal como están allá —la clave es lo que permite conciliar—. Después se le asigna uno a cada equipo, y sus órdenes lo heredan.
- **Activos** — El catálogo de equipos. Es la importación más importante y la que más tiempo ahorra.
- **Medidores** — Horómetros, odómetros y contadores de cada equipo, con su lectura inicial.
- **Lecturas de medidores** — Lecturas de los medidores que ya existen. Pasan por las mismas reglas que una lectura capturada a mano: no negativas, no hacia atrás, no en el futuro, y un horómetro no avanza más horas de las que pasaron.
- **Proveedores** — Quién surte las refacciones y los servicios.
- **Familias de refacción** — Clasificación de las refacciones del almacén.
- **Unidades de medida** — Cómo se cuenta cada refacción.
- **Refacciones** — El catálogo del almacén con sus existencias iniciales.
- **Existencias iniciales** — Cuánto hay de cada refacción en cada almacén. Cada renglón entra como un movimiento de entrada en el kardex, con su costo: la existencia nunca aparece sin origen.
- **Especialidades** — Los oficios del personal y su tarifa por hora, para estimar la mano de obra de los planes.
- **Servicios externos** — Los trabajos que se subcontratan a proveedores. Son el tercer costo de una orden, junto a mano de obra y refacciones.
- **Planes de mantenimiento** — Los planes preventivos por calendario, cada uno ya aplicado a su equipo. Para que generen órdenes les faltan sus actividades: se agregan después, abriendo cada plan.
- **Códigos de falla** — Qué falló. Se usa al cerrar una orden correctiva.
- **Causas raíz** — Por qué falló. Alimenta el análisis de fallas repetidas.

## Seguridad y respaldo

- Cada empresa ve solo su información: toda consulta se filtra por empresa.
- Acceso por rol: cada persona ve y hace solo lo de su función.
- Los archivos no son públicos; cada descarga se autoriza por unos minutos.
- Bitácora de auditoría: quién hizo qué y cuándo.
- Respaldo automático diario de la base de datos; se conservan 7. Recuperación a un punto en el tiempo dentro de los últimos 7 días.
- Opera en Google Cloud, región us-central1 (Estados Unidos).
