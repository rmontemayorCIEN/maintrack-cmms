# Bloque 2 — Almacén, requisiciones y compras

El ciclo real del material, cerrado de punta a punta:

```
actividad de la OT → requisición → entrega total o parcial → faltante →
compra → recepción → inventario → consumo o devolución
```

No se agregó contabilidad, cuentas por pagar, facturación ni funciones de IA.

## Por qué

El material se clasificaba por el **tipo del encabezado de la orden**. Una OT
preventiva que en el mismo viaje atendía una fuga cargaba al preventivo el
empaque de la falla. El costo por tipo de mantenimiento —uno de los pocos
números que el cliente usa para decidir— era falso, y no había forma de verlo
desde la actividad que generó la necesidad.

Alrededor de eso, el ciclo tenía huecos que no avisaban: se podía surtir dos
veces con doble clic, comprar dos veces el mismo faltante, recibir de más,
autorizar por encima del límite, y el kardex podía quedar mintiendo si dos
movimientos caían juntos.

## El modelo de la relación

| Dato | Dónde vive | Qué responde |
|---|---|---|
| `MaterialRequestLine.taskId` | renglón del vale | qué actividad necesitó ese material |
| `WorkOrderPart.taskId` | cargo de la OT | a qué actividad se le aplicó el costo |
| `PurchaseRequestLine.materialRequestLineId` | renglón de compra | qué faltante se está comprando |
| `WorkOrderPart.devuelto` | cargo de la OT | cuánto regresó al almacén |
| `GoodsReceipt.clave` | recepción | idempotencia: la misma recepción no entra dos veces |

El tipo de la actividad lo decide **una sola función**,
`tipoDeActividad(task.maintenanceType, wo.maintenanceType)` en `lib/fallas.ts`.
Sin actividad no se inventa clasificación: cae en «Consumo general de la OT» si
así se pidió, o «actividad no especificada» si es un vale anterior al cambio.

## Qué se corrigió

- **Material por actividad.** El vale pide la actividad por renglón; el formulario
  lista las actividades de la OT y hereda su tipo. Un vale con actividades de
  distinto tipo se marca «Varios tipos (ver cada renglón)», no una sola.
- **Costo atribuido.** `costoDeMaterialPorTipo` reparte por actividad y reporta
  aparte lo que solo trae el tipo del encabezado. No se reparte nada con reglas
  inventadas.
- **Entregas parciales**, faltante calculado y visible, y compra del faltante sin
  duplicar: `cubiertoPorCompras` rechaza el segundo intento.
- **Doble clic**: los renglones y el stock se actualizan con `updateMany`
  condicional (solo si el renglón sigue como se leyó). La recepción usa clave
  idempotente y atrapa el P2002 devolviendo la recepción que ya existía.
- **Existencias negativas**: imposibles; `aplicarMovimiento` sigue siendo el único
  punto donde cambia el stock y ahora también valida que el saldo no cambió
  bajo sus pies.
- **Límite de autorización** en el servidor, no en la pantalla; por debajo del
  umbral la compra queda autorizada sin firma y se dice así.
- **Devoluciones** que bajan el costo de la actividad correcta.
- **Costo pendiente**: una refacción sin costo se entrega, el cargo queda en cero
  y la requisición lo advierte en vez de fingir un número.
- **Aislamiento por organización** en almacén, vales y compras, con prueba.

## Archivos y migraciones

- Migración `20260917131040_materiales_trazabilidad`: `WorkOrderPart.devuelto`,
  `PurchaseRequestLine.materialRequestLineId`, `GoodsReceipt.clave` (único por
  organización).
- Migración `20260917143119_material_por_actividad`: `MaterialRequestLine.taskId`
  con índice y borrado en `SET NULL`.
- `lib/material-por-actividad.ts` (nuevo), `lib/requisiciones-datos.ts` (nuevo,
  puro: lo importan las pantallas), `lib/requisiciones.ts`, `lib/compras.ts`,
  `lib/almacen.ts`.
- Pantallas: alta de requisición, detalle de requisición, detalle de la OT
  («Material por actividad»), compras, inventario, reportes.

Ambas migraciones son aditivas y traen su SQL de reversa en el encabezado.

## Pruebas

- `scripts/prueba-materiales.ts` — 44 revisiones: el ciclo completo llamando a
  las mismas funciones que usan las rutas, la orden mixta preventivo/correctivo,
  devoluciones, kardex contra existencia, aislamiento.
- `scripts/prueba-http-materiales.ts` — 14 revisiones contra las rutas reales,
  con sesión firmada: permisos, validación de actividad ajena a la OT,
  idempotencia y duplicados.
- Suite completa: todo pasa salvo las cinco `*-real`, que piden llave de IA o
  datos de producción.

## Lo que queda pendiente, y se dice

- Las requisiciones **históricas** conservan su renglón sin actividad. No se les
  asignó una a la fuerza: se muestran como «actividad no especificada».
- En producción quedan 3 vales con motivo mal clasificado y un cargo de más en
  OT-000001. No se corrigen solos: hace falta decidirlos a mano.
- Las entradas directas al almacén (ajustes, altas) todavía no llevan clave
  idempotente; el riesgo es un doble clic en una entrada manual.
- «Armar una orden» no toma las solicitudes de forma atómica.
