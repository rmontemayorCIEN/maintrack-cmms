# Bloque 4 — Puesta en marcha y calidad de datos

Que una empresa nueva pueda configurarse, importar su información, corregirla
y empezar a operar **sin depender del desarrollador**, y que el avance que ve
diga la verdad.

## Diagnóstico inicial

| Hallazgo | Consecuencia |
|---|---|
| El avance **contaba registros**: 5 activos daban el paso por hecho aunque ninguno tuviera ubicación; un plan contaba aunque no tuviera actividades ni equipo asignado | Una cuenta podía verse al 100% con planes que nunca generarían una orden |
| La importación guardaba **renglón por renglón, sin transacción**: si fallaba el 50, los primeros 49 se quedaban | Cargas a medias, sin forma de saber qué entró |
| El límite del plan revisaba «¿cabe uno más?», no «¿caben los del archivo?», aunque el comentario del código decía lo contrario | Importar 400 activos con 380 lugares libres pasaba completo |
| Los duplicados solo se detectaban por **código exacto**; todo lo demás se omitía o se creaba sin avisar | El mismo equipo con dos TAG quedaba dos veces |
| `new Date("30/02/2026")` se volvía **2 de marzo**; «1,5» se leía como 15 | Fechas y cantidades equivocadas, en silencio |
| No había **registro de importaciones** ni forma de deshacerlas | Revertir era buscar a mano |
| Había **cuatro listas de catálogos** distintas (alta por el operador, registro público, botón de catálogos, script) y ninguna adaptada al tipo de instalación | Un restaurante recibía «Maniobra con grúa» y «Desalineación de acoplamiento» |
| Toda empresa nueva recibía un sitio «Planta principal» y no había almacén | Una flotilla con «Planta principal»; importar refacciones con existencia fallaba |
| El tipo de instalación solo lo podía poner el proveedor del servicio | La empresa no podía avanzar ese paso sola |
| No existían datos de demostración controlados | — |

## Reglas del porcentaje

Doce pasos. El porcentaje sale de los **once primeros** —la validación final
es el resultado, no un paso más— y solo de los que la empresa tiene que hacer:
los **opcionales** y los que **no aplican** no le bajan el avance.

Cada registro cuenta **solo si sirve para operar**:

| Paso | Un registro cuenta si… |
|---|---|
| Sitios | tiene nombre y no está repetido (comparado sin acentos ni mayúsculas) |
| Ubicaciones | tiene sitio, nombre y no está repetida en el mismo sitio. En flotillas no aplica |
| Equipo | está activo y es técnico o supervisor. Sin tarifa por hora: requiere corrección |
| Activos | tiene código, nombre, estado válido, sitio y —si la empresa usa ubicaciones— ubicación |
| Medidores | tiene al menos una lectura. Obligatorio en flotillas o si hay planes por medidor |
| Planes | está asignado a un equipo, tiene frecuencia, actividades y próxima fecha |
| Almacén | hay almacén activo; cada refacción tiene unidad del catálogo y existencia que cuadra con sus almacenes |
| Proveedores | no está repetido por nombre ni por RFC, y su RFC está bien formado. Opcional salvo que compre por el sistema |
| Reglas | jornada mayor a cero y días laborables definidos |

Estados: **Completo**, **En proceso**, **Requiere corrección**, **Opcional**,
**No aplica**. Un paso por corregir nunca pesa más de 90% aunque casi todo esté
bien. **Los datos de demostración no cuentan**: una empresa con demo tiene
exactamente el mismo avance que sin ella.

El porcentaje sale de `puestaEnMarcha()` y lo leen el panel principal, la
pantalla de puesta en marcha, la consola del operador y la revisión con IA.
Hay una prueba que abre las tres pantallas y compara el número.

## Pendientes

Cada pendiente trae **problema, módulo, consecuencia, cuántos registros, los
primeros cinco con enlace directo, y la acción**. En orden de lo que más
estorba: crear órdenes → programar mantenimiento → indicadores → materiales →
compras → identificar equipos y lugares.

## Importación segura

**Formatos:** Excel (`.xlsx`) y CSV, por **las mismas reglas**. Los dos se leen
a la misma tabla de texto y de ahí en adelante no hay dos caminos. De un Excel
se toma la primera hoja (en el orden del libro); las celdas de fecha se leen
como dd/mm/aaaa, los números con su punto decimal, los verdaderos como SI/NO.
Se lee sin dependencias nuevas (`lib/xlsx.ts`, con `node:zlib`), con tope de
descompresión y sin expandir entidades XML. Un `.xls` antiguo se rechaza
diciendo cómo guardarlo. Las plantillas se descargan en los dos formatos.

**Tipos disponibles (18):** sitios, ubicaciones, **usuarios y responsables**,
**almacenes**, categorías de activo, activos, **medidores** (con lectura
inicial), **lecturas**, proveedores, familias de refacción, unidades,
refacciones, **existencias iniciales por almacén**, especialidades, servicios
externos, planes (ahora con tipo: preventivo, inspección, predictivo), códigos
de falla y causas raíz.

La relación refacción–almacén vive en **existencias iniciales**: cada renglón
es refacción + almacén + cantidad + costo, y entra por `aplicarMovimiento()`
como entrada al kardex. No hizo falta un importador aparte.

1. **Validar** — no escribe ningún dato. Deja la entrada **validada** en el
   historial (la misma si se vuelve a validar el mismo archivo). Totales:
   filas, válidas, con advertencia, rechazadas, nuevas, actualizarán, exactos,
   posibles, columnas no reconocidas y obligatorias faltantes. Cada error
   trae **fila, columna, valor recibido, problema y cómo corregirlo**, en
   pantalla y en el detalle descargable.
2. **Confirmar** — vuelve a validar sobre la base de ese momento. La política
   se dice antes de confirmar: **con un solo renglón rechazado no se importa
   nada**. Guarda **todo o nada** en una transacción; ningún importador
   consume folios consecutivos, así que una falla no deja huecos.

Estados del lote: **Validada → Confirmada → Completada / Completada con
advertencias / Fallida**, y después **Revertida / Reversión parcial /
Reversión bloqueada**. Una fallida guarda el motivo y los primeros errores
(fila y columna), nunca el archivo.

### Importadores nuevos

| Tipo | Valida | Notas |
|---|---|---|
| Usuarios | nombre, correo, rol (técnico, supervisor, administrador, solicitante, compras, consulta), puesto, tarifa, teléfono, estado | **Sin contraseñas**: una columna contrasena/password/clave se avisa y se ignora. Se guarda el hash de un valor aleatorio; la persona entra con la liga de un solo uso que ya existe (Configuración → Usuarios). El propietario no se importa. Un correo de otra empresa se rechaza sin decir cuál. Actualizar solo toca nombre, puesto, tarifa y teléfono. |
| Almacenes | código, nombre, sitio, responsable (por correo), estado, general | Solo un almacén general. |
| Medidores | activo, nombre, unidad, tipo, lectura inicial (no negativa), fecha, máximo por día (horómetro ≤ 24) | La lectura inicial queda como valor inicial formal del medidor. |
| Lecturas | activo, medidor, valor, fecha (obligatoria) | Las mismas reglas que la captura (`validarLectura`): menor que la anterior o físicamente imposible se rechaza, también contra renglones anteriores del mismo archivo. Se registran con `registrarLectura` dentro de la transacción. |
| Existencias iniciales | refacción, almacén, cantidad (> 0), costo (por omisión el de la refacción), unidad (debe coincidir) | Movimiento de entrada en el kardex con su costo y quién lo importó. Si ya hay existencia: omitir o ajustar (queda como ajuste). |

Validaciones: fechas estrictas (dd/mm/aaaa; las imposibles se rechazan),
números (la coma solo como miles), correos, teléfonos, RFC, unidades con
sinónimos («Piezas», «pz» → «pza»), monedas, códigos, series. Lo que se guarda
conserva acentos y mayúsculas; lo que se normaliza es la clave de comparación,
que nunca se guarda. Un dato **opcional** mal escrito avisa y se deja vacío;
uno **obligatorio** es error.

## Duplicados

| Clasificación | Cuándo | Qué se puede decidir |
|---|---|---|
| Exacto | misma clave (TAG, código, nombre del proveedor) | omitir o actualizar el existente |
| Posible | otra clave, pero mismo nombre en la misma ubicación, misma serie, mismo RFC, o —en planes— mismo equipo y frecuencia | omitir (por omisión) o crear como nuevo |
| Diferente | nada de lo anterior | se crea |

**Nunca se combinan dos registros por parecido.** Actualizar una refacción no
toca su existencia: mover stock solo pasa por `aplicarMovimiento`.

## Reversión

Cada importación es un **lote** (`ImportBatch`): empresa, usuario, fecha, tipo,
nombre y **huella SHA-256** del archivo —no su contenido—, creados,
actualizados, omitidos y resultado.

Revertir **deshace solo lo que el lote creó y nadie usó después**. Casi todo se
borra; una **lectura se anula** con motivo (nunca se borra una lectura) y una
**existencia se compensa** con una salida al kardex (el kardex no se reescribe). Se considera
usado: cualquier referencia desde fuera del lote (órdenes, movimientos,
consumos, asignaciones, activos en esa ubicación…) o haberlo editado después.
Lo usado se queda y se lista con su motivo. Usuarios: bloquea haber entrado,
tener ligas, órdenes, horas, lecturas, almacenes a su cargo o acciones en la
bitácora. Almacenes: existencias, movimientos, compras, traspasos. Medidores:
lecturas vigentes o planes por uso. Lecturas y existencias: cualquier lectura
o movimiento posterior en el mismo medidor o almacén. Lo que el lote **actualizó** no se
regresa: se muestra para revisarlo a mano. Antes de confirmar se ve exactamente
qué se deshace y cómo, qué no y por qué, y el **resultado esperado**. Todo en
una transacción, y solo dentro de la empresa de la sesión. Lo anulado o
compensado se marca en el lote (`REVERTED`) para que una segunda reversión no
lo repita.

## Catálogos por tipo de instalación

Una lista **común** corta (unidades, fallas y causas genéricas, dos
especialidades) más una **propia de cada tipo**: planta, edificio, plaza,
hospital, escuela, club deportivo, hotel, restaurante, bodega, flotilla,
residencial u otro. Ningún tipo recibe más de diez categorías. Vive en
`lib/catalogos-estandar.ts` y la usan el alta de empresas, el registro, el
botón de catálogos y el script.

Tres cosas distintas: **catálogo base del sistema** (estados, prioridades,
tipos de mantenimiento: constantes del código), **catálogos de la empresa**
(este archivo, editables) y **datos de ejemplo** (`lib/demo.ts`).

## Cómo arranca una empresa

Tres niveles de datos que no se mezclan (`lib/modos-inicio.ts`):

- **Catálogos técnicos indispensables** — unidades, códigos de falla y causas
  genéricos, dos especialidades. Iguales para todos los giros.
- **Configuración recomendada** — los catálogos del tipo de instalación, su
  primer sitio con el nombre del giro y el almacén general. Ni activos, ni
  órdenes, ni movimientos, ni indicadores.
- **Datos de demostración** — tres equipos, un plan con actividades, dos
  refacciones con existencia y un proveedor, con «[DEMO]», como lote DEMO.
  Sin usuarios de ejemplo.

En el **alta del operador** se elige una de las tres (**Comenzar vacía**,
**Cargar configuración recomendada**, **Crear datos de demostración**), con lo
que incluye y lo que no a la vista antes de crear; sin elegir no se crea. El
registro público arranca vacía y ofrece las otras dos en la puesta en marcha.
Las empresas que ya existían no cambian.

**Eliminar datos de demostración** muestra antes: activos, OT relacionadas,
planes, refacciones y valor del inventario, movimientos, proveedores, usuarios
demo (siempre 0) e indicadores afectados. Pide una casilla de confirmación
explícita. Solo toca lo registrado en el lote DEMO —**nunca por nombre, fecha
ni parecido**: un activo real con «[DEMO]» en el nombre no se toca—; lo ligado
a datos reales se queda y se lista.

## Estado operativo

Aparte del **estado comercial** (prueba, activa, suspendida), que es del
operador y **nunca cambia solo**:

| Estado | Cuándo |
|---|---|
| En configuración | hay bloqueos críticos |
| Lista para operar | sin bloqueos críticos, falta declararlo |
| Operando | alguien lo declaró (`operandoDesde`, `operandoPorId`) |

**Bloquean:** datos generales (zona, moneda, tipo de instalación), sitio,
ubicación (si aplica), un técnico o supervisor activo, al menos un activo y
ninguno incompleto, planes (al menos uno, y en todos los equipos críticos),
reglas operativas y datos de demostración. **Solo avisan:** tarifas, almacén,
proveedores, medidores, duplicados y planes con defectos.

Es informativo: no apaga ninguna función, así que ninguna empresa que ya
operaba se detiene. Se ve en la consola del operador (junto al comercial), en
la puesta en marcha y en el panel. El porcentaje no cambió.

**Planes:** «Planes existentes: X de Y correctos» y «Cobertura crítica: A de
B», por separado, con el código del equipo que falta. Si todos los planes están
bien y falta cobertura, el paso queda **en proceso**, no «requiere corrección»
(el avance es el mismo: ninguno pasa de 90%).

## Permisos, aislamiento y bitácora

Importar, validar, revertir, configurar la empresa, administrar catálogos y
quitar la demo piden `settings:write` (propietario y administrador). Todo
trabaja sobre la organización de la sesión; un lote de otra empresa da 404.

Bitácora: `IMPORT_VALIDATED`, `IMPORT_CONFIRMED`, `IMPORT_COMPLETED` (creados,
actualizados, duplicados omitidos), `IMPORT_FAILED`, `IMPORT_REVERT_REQUESTED`,
`IMPORT_REVERTED`, `IMPORT_REVERT_PARTIAL`, `IMPORT_REVERT_BLOCKED`,
`IMPORT_REVERT_REJECTED`, `ORG_CREATED` (con su modo), `SETUP_STARTED` (con su
modo), `SETUP_CHANGED`, `DEMO_CREATED`, `DEMO_REMOVED` (con los conteos),
`DEMO_REMOVAL_BLOCKED`, `OPERATION_STARTED` (estado anterior y advertencias),
`CATALOGS_SEEDED`. Sin contenido de archivos, contraseñas ni ligas.

## Pruebas

| Prueba | Cubre (numeración del bloque) |
|---|---|
| `prueba-importacion-segura.ts` | 5–14, 19, 20: válida, columnas faltantes, fechas y números, duplicados, actualización, falla a media carga, reversión completa y bloqueada, otra empresa, rol sin permiso, 2,000 renglones, límite del plan, bitácora |
| `prueba-puesta-en-marcha.ts` | 1–4, 15–18: vacía, parcial, avance con incompletos, mismo porcentaje en tres pantallas, demo separada y removible, catálogos por tipo, pendientes concretos, comenzar a operar |
| `prueba-cierre-bloque-4.ts` | Cierre, las 27 obligatorias: CSV y Excel iguales, Excel real, errores con valor y solución, falla sin datos parciales, usuarios sin contraseñas, almacenes y existencias, lecturas válidas e inválidas, reversión completa/parcial/bloqueada, otra empresa, permisos por HTTP (validar, confirmar, revertir), tres modalidades de alta, demo controlada, catálogos por tipo, estado operativo, cobertura y bitácora. Al final comprueba que las demás empresas quedaron idénticas. |

## Migración

`20260917223341_lotes_de_importacion` — aditiva: `ImportBatch`, `ImportRecord`,
`Supplier.rfc`, `Organization.operandoDesde` y `Organization.modulosPuesta`.

`20260918070947_estado_operativo` — aditiva: `Organization.operandoPorId`.
Los estados de lote son texto: no hizo falta migrarlos.

## Pendientes reales

- Las empresas **que ya existen** no cambian: sus sitios «Planta principal» y
  sus catálogos viejos se quedan. No se tocó ningún dato.
- La reversión no regresa los registros **actualizados**; los lista.
- Una fecha inválida en una columna **opcional** (fecha de compra, garantía) se
  avisa y el campo queda vacío; en una obligatoria (fecha de lectura) se
  rechaza. Es la regla previa del bloque y se mantuvo.
- Las empresas existentes aparecen «en configuración» hasta que alguien
  declare que operan: el estado es nuevo y no se infiere de su historia.
- El «Comenzar vacía» del registro público recibe menos catálogos que antes
  (solo los indispensables); los del giro se cargan en un clic desde la puesta
  en marcha.
- El proveedor se reconoce por nombre; los que ya existían no tienen RFC hasta
  que se capture o se importe.
- La detección de posibles duplicados es exacta sobre la clave normalizada: no
  detecta errores de dedo («Bomba» contra «Bmoba»).
- Los datos de demostración se quitan si nadie los usó; si alguien ya los usó en
  una orden real, se quedan y se listan.
