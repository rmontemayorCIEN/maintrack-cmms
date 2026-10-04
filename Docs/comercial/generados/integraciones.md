<!-- Generado por scripts/generar-documentos-comerciales.ts. No se edita a mano: cambie la fuente y vuelva a generar. -->

# MainTrack y su ERP

> MainTrack no se conecta a su ERP: publica una API y recibe eventos. Su equipo de sistemas —o nosotros, con un agente instalado en su red— empuja y jala lo que haga falta. Es la única forma de integrar dos sistemas sin que la actualización de uno rompa al otro.

## Por qué así y no con un conector

- Un conector se hace contra una versión. El cliente actualiza su ERP y el conector se cae, con el proveedor del CMMS de culpable.
- La API no cambia cuando cambia el ERP. Lo que se adapta es el lado del cliente, que es quien conoce su propio sistema.
- Cada empresa quiere campos distintos en lugares distintos. Un conector genérico no atina, y uno a la medida es un desarrollo que hay que cotizar como tal.

## Las dos direcciones

**Lo que el ERP —o un sensor, o una pasarela— le mete a MainTrack**

- Solicitudes de trabajo, desde cualquier sistema que detecte un problema
- Lecturas de medidor: horómetros, odómetros, ciclos. Pasan la misma validación que la captura en pantalla
- Condiciones de sensores: vibración, temperatura, presión, con sus umbrales
- Catálogos y existencias por archivo, con reversión

**Lo que MainTrack le entrega al ERP**

- Consultas: activos con su estado, ubicaciones, órdenes, existencias por almacén, conteos de pendientes
- Avisos en el momento: 29 eventos del catálogo, firmados y con reintentos
- Compras por colocar, con su justificación y su renglonaje
- Recepciones y consumo, para que el ERP descargue y contabilice

## Lo que ya está hecho

Nada de esta sección es un plan: está en producción hoy.

### API propia, con versión

Rutas bajo /api/v1 para consultar activos, ubicaciones, órdenes, inventario y el estado general, y para recibir solicitudes, lecturas de medidores, condiciones de sensores y eventos. El índice de la API se consulta en línea y dice qué rutas hay y qué permiso pide cada una.

### Credenciales que da el cliente, no nosotros

En Configuración › Integración la empresa crea sus propias llaves y elige de 11 permisos qué puede hacer cada una. El secreto se muestra una sola vez; en la base solo queda su huella. Se revoca o se rota sin llamarnos.

### La empresa sale de la llave

Nunca de un parámetro de la petición. Un sistema externo no puede leer los datos de otro cliente ni por error ni a propósito; pedirlos responde «no encontrado», igual que pedir algo que no existe.

### Reintentar no duplica

Las rutas que escriben aceptan una clave de idempotencia: si la red se cae a media petición y el ERP reintenta, no se crea un segundo registro; se devuelve la misma respuesta de la primera vez.

### Webhooks firmados, 29 eventos

MainTrack avisa al sistema del cliente cuando pasa algo: se abrió una orden crítica, se venció un preventivo, una refacción quedó bajo mínimo, hay una compra por autorizar, llegó la mercancía. Cada webhook tiene su secreto de firma, con reintentos, historial de entregas y suspensión automática si el destino deja de responder.

### Bitácora de todo lo que entra

Quién llamó, qué ruta, cuándo y con qué resultado —incluidos los intentos rechazados—. Cuando algo no llegó, se puede decir de qué lado se quedó sin discutirlo.

### Carga masiva por archivo

Para arrancar, o para lo que no valga la pena automatizar: el catálogo completo entra por archivo —sitios y ubicaciones, activos, medidores y sus lecturas, refacciones y existencias, proveedores, planes y catálogos de falla—. Se valida en seco antes de escribir, se confirma, y si algo salió mal el lote completo se revierte.

### Límites para que una integración no tire el sistema

120 peticiones por minuto por llave y 600 por empresa; las lecturas tienen 300, porque una pasarela de sensores manda en ráfagas. Cada empresa tiene su propio contador: nadie consume el de otro.

## Los 11 permisos que se le pueden dar a una llave

El cliente elige uno por uno. Lo que no marque, no existe para ese sistema externo.

| Permiso | Qué habilita |
|---|---|
| `activos:leer` | Consultar activos y su estado |
| `ubicaciones:leer` | Consultar sitios y ubicaciones |
| `ordenes:leer` | Consultar órdenes de trabajo (sin nombres de personas) |
| `solicitudes:crear` | Crear solicitudes de trabajo |
| `lecturas:crear` | Registrar lecturas de medidores y condiciones de sensores |
| `inventario:leer` | Consultar existencias de refacciones |
| `compras:leer` | Consultar requisiciones de compra y su avance |
| `compras:escribir` | Registrar la orden de compra colocada y la recepción de mercancía |
| `estado:leer` | Consultar el estado general (conteos de pendientes) |
| `costos:leer` | Ver costos en activos, órdenes e inventario |
| `eventos:enviar` | Enviar eventos entrantes (webhook entrante) |

## Los 29 eventos que MainTrack puede avisar

Cada webhook elige cuáles recibe. Van firmados, con reintentos y con historial de entrega.

- **Órdenes de trabajo:** OT asignada, OT reasignada, Cambio de prioridad, OT crítica, OT vencida, OT detenida, OT lista para revisión, OT devuelta, OT cerrada.
- **Solicitudes:** Solicitud nueva, Solicitud atendida, Solicitud rechazada.
- **Mantenimiento preventivo:** Falló una orden programada, Preventivo incumplido.
- **Medidores y predictivo:** Lectura cerca del límite, Umbral excedido, Lectura anormal, Alerta predictiva, Condición normalizada.
- **Garantías y vigencias:** Vigencia por vencer, Vigencia vencida, Se abrió trabajo sobre un equipo en garantía.
- **Almacén:** Refacciones bajo mínimo, Refacción crítica agotada.
- **Compras:** Compra por autorizar, Compra autorizada o rechazada, Compra vencida, Recepción parcial, Ya llegó lo que pidió.

## Lo que entra por archivo

Para el arranque, y para lo que no valga la pena automatizar. Cada tipo se valida en seco antes de escribir, y el lote completo se puede revertir.

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

## ¿De quién es el almacén de refacciones?

De esta respuesta depende todo lo demás. Si no se define, se descubre a medio camino y se rehace.

### El almacén vive en MainTrack — recomendada

El técnico consume del almacén de mantenimiento y MainTrack mueve la existencia con su kardex y su costo promedio ponderado; después le informa al ERP el movimiento para que lo contabilice.

- **A favor:** Es lo que hace que el costo por activo, el costo por orden y los indicadores sean reales. Los mínimos disparan la compra solos.
- **En contra:** Hay que acordar con contabilidad quién manda en el número.

### El almacén vive en el ERP y MainTrack lo refleja

MainTrack muestra la existencia de solo lectura para poder planear el trabajo, y cuando el técnico consume le avisa al ERP para que descargue.

- **A favor:** Nadie pelea por la verdad del inventario y el contador sigue en su sistema.
- **En contra:** La existencia que se ve tiene el retraso del último jalón, y MainTrack pierde el kardex y el costeo propios: con eso se van el costo real por activo y parte de los indicadores.

Muchas plantas acaban partiéndolo: el almacén general en el ERP y el de mantenimiento en MainTrack, con traspasos entre los dos. Funciona bien y es la salida cuando el cliente no quiere ceder ninguno de los dos.

## Qué esperar de cada ERP

### Dynamics 365 — El más sencillo

Business Central y Finance & Operations exponen OData y Dataverse, con avisos propios. La integración es cuestión de días de trabajo del lado del cliente, no de meses.

### Oracle — Sencillo

Fusion y NetSuite tienen servicios REST bien documentados. Técnicamente el más limpio de todos.

### SAP — Técnicamente sí, políticamente despacio

S/4HANA y Business One tienen servicios para esto. El obstáculo no es técnico: el área de SAP del cliente tiene su propio calendario, su consultor y su presupuesto. No se comprometen fechas que dependan de ellos.

**Ojo:** Si el cliente ya usa el módulo de mantenimiento de SAP (PM), la conversación no es de integración sino de reemplazo, y el argumento es otro.

### CONTPAQi — Necesita un agente en su red

Es el caso más frecuente en México y el más delicado: normalmente es software de escritorio sobre una base de datos en la red del cliente, sin nada a qué llamarle desde internet. Se resuelve con un programa chico instalado en su red que lee su base y empuja a la API de MainTrack —que ya está lista para recibir—.

**Ojo:** Confírmelo caso por caso: depende del producto y la versión, y CONTPAQi ha ido moviendo cosas a la nube.

## Lo que hay que preguntarle a su área de sistemas

Sin estas respuestas no hay alcance, y sin alcance no hay cotización.

1. ¿Qué ERP, qué versión, y está en la nube o en un servidor de la planta?
2. ¿Tiene servicios web habilitados, o habría que instalar algo en su red?
3. ¿Quién del lado de ustedes desarrolla y mantiene la integración, y con qué disponibilidad?
4. ¿De quién es el almacén de refacciones: del ERP o de mantenimiento?
5. ¿El código de la refacción y el del activo van a ser los mismos en los dos sistemas?
6. ¿Qué tiene que ver el ERP de lo que pasa en mantenimiento: el consumo, el costo por activo, las compras, todo?
7. ¿Cada cuándo necesitan que la información esté igual en los dos lados: al instante, cada hora, una vez al día?

## Lo que MainTrack no hace

- No hay conectores de fábrica para ningún ERP. Hay una API y un catálogo de eventos; la parte que habla con el ERP la hace quien conoce ese ERP.
- MainTrack no jala solo de un sistema ajeno: el cliente empuja, o se instala un agente en su red que lo haga por él. Un jalón programado se puede construir, pero hoy no está.
- La API no da acceso a usuarios, contraseñas, bitácora ni configuración: esos datos no existen ahí. Los costos solo se ven con el permiso que los incluye.
- Nada externo mueve una orden de trabajo ni un plan directamente. Manda un hecho —una lectura, una solicitud— y las reglas del sistema deciden qué hacer con él.

## El ERP sabe cuánto costó. No sabe por qué se volvió a romper.

Un ERP registra que se compró un rodamiento y cuánto se pagó. No sabe que ese rodamiento fue a la bomba 3, que es la cuarta vez en ocho meses, que la causa raíz es desalineación, y que el paro cuesta más que la refacción. MainTrack sí. Integrarlos no es sincronizar almacenes: es devolverle al ERP el costo real de mantenimiento por activo, por línea y por centro de costo —mano de obra, refacciones, servicios externos y tiempo perdido— que hoy no tiene de dónde sacar.

---

La referencia técnica de la API —rutas, cuerpos, códigos de error y ejemplos— está en `Docs/api-v1.md`, y el índice vivo en `GET /api/v1` de la instalación del cliente.
