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

**Tipos disponibles:** sitios, ubicaciones, categorías de activo, activos,
proveedores, familias de refacción, unidades, refacciones, especialidades,
servicios externos, planes, códigos de falla y causas raíz.

1. **Validar** — no escribe nada. Por renglón: nuevo, ya existe, posible
   duplicado, actualiza, o error con **fila y columna**. Reporta columnas no
   reconocidas y obligatorias faltantes. El detalle se descarga en CSV.
2. **Confirmar** — vuelve a validar sobre la base de ese momento. **Con un solo
   error no importa.** Guarda **todo o nada** en una transacción.

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

Revertir **borra solo lo que el lote creó y nadie usó después**. Se considera
usado: cualquier referencia desde fuera del lote (órdenes, movimientos,
consumos, asignaciones, activos en esa ubicación…) o haberlo editado después.
Lo usado se queda y se lista con su motivo. Lo que el lote **actualizó** no se
regresa: se muestra para revisarlo a mano. Antes de confirmar se ve exactamente
qué se borra y qué no. Todo en una transacción, y solo dentro de la empresa de
la sesión.

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

Al darse de alta recibe **solo sus catálogos**. En la puesta en marcha elige:

- **Vacía** — nada más.
- **Estructura recomendada** — su primer sitio, con el nombre de su giro, y el
  almacén general.
- **Demostración** — la estructura más tres equipos, un plan con actividades,
  dos refacciones y un proveedor, todos con «[DEMO]» y registrados como un lote
  DEMO. Se quitan con la misma reversión segura. **Mientras existan no se puede
  comenzar a operar**, y no cuentan en el avance.

**Comenzar a operar** usa la misma revisión que muestra la pantalla y queda en
la bitácora (`operandoDesde`).

## Permisos, aislamiento y bitácora

Importar, validar, revertir, configurar la empresa, administrar catálogos y
quitar la demo piden `settings:write` (propietario y administrador). Todo
trabaja sobre la organización de la sesión; un lote de otra empresa da 404.

Bitácora: `IMPORT_VALIDATED`, `IMPORT_STARTED`, `IMPORTED`, `IMPORT_FAILED`,
`IMPORT_REVERT_REQUESTED`, `IMPORT_REVERTED`, `IMPORT_REVERT_REJECTED`,
`SETUP_STARTED`, `SETUP_CHANGED`, `DEMO_CREATED`, `DEMO_REMOVED`,
`OPERATION_STARTED`, `CATALOGS_SEEDED`. Sin contenido de archivos.

## Pruebas

| Prueba | Cubre (numeración del bloque) |
|---|---|
| `prueba-importacion-segura.ts` | 5–14, 19, 20: válida, columnas faltantes, fechas y números, duplicados, actualización, falla a media carga, reversión completa y bloqueada, otra empresa, rol sin permiso, 2,000 renglones, límite del plan, bitácora |
| `prueba-puesta-en-marcha.ts` | 1–4, 15–18: vacía, parcial, avance con incompletos, mismo porcentaje en tres pantallas, demo separada y removible, catálogos por tipo, pendientes concretos, comenzar a operar |

## Migración

`20260917223341_lotes_de_importacion` — aditiva: `ImportBatch`, `ImportRecord`,
`Supplier.rfc`, `Organization.operandoDesde` y `Organization.modulosPuesta`.

## Pendientes reales

- Las empresas **que ya existen** no cambian: sus sitios «Planta principal» y
  sus catálogos viejos se quedan. No se tocó ningún dato.
- La reversión no regresa los registros **actualizados**; los lista.
- El proveedor se reconoce por nombre; los que ya existían no tienen RFC hasta
  que se capture o se importe.
- La detección de posibles duplicados es exacta sobre la clave normalizada: no
  detecta errores de dedo («Bomba» contra «Bmoba»).
- Los datos de demostración se quitan si nadie los usó; si alguien ya los usó en
  una orden real, se quedan y se listan.
