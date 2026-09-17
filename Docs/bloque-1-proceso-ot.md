# Bloque 1 — Integridad del proceso operativo (órdenes de trabajo)

Cierre del 17 de septiembre de 2026. Publicado en producción: revisiones
`maintrack-cmms-00169` a `00173`.

El bloque anterior (predictivo, fechas, hidratación, regla de falla, medidores)
queda como **Bloque 1 antiguo**; su cierre está en `bloque-1-cierre.md`.

## Qué cambió, en una línea por tema

| Tema | Antes | Ahora |
|---|---|---|
| Acciones de la orden | Una completada ofrecía «Iniciar» | Solo las acciones válidas para el estado y el rol (`lib/reglas-ot.ts`) |
| Cerrar | Con permiso de ejecutar | Completar (técnico) y cerrar (supervisor) son pasos distintos |
| Reabrir | Imposible | Administración o propietario, con motivo |
| Motivos | Pausar y cancelar no pedían nada | Espera, cancelación, devolución, reapertura y reactivación piden motivo, visible en la orden |
| Iniciar | Se podía iniciar sin responsable | Se toma, o excepción con motivo para supervisor en adelante; se dice en la orden por rol |
| Cierre técnico | Solo revisaba actividades | Solución, horas (o excepción), paro (o confirmar que no hubo), diagnóstico (o «Sin determinar» justificado), actividades resueltas y evidencia si la empresa la exige |
| Orden cerrada | Aceptaba horas y refacciones | No acepta cambios sensibles sin reabrir |
| Doble clic | Repetía paro y avance de plan | Una sola transición; la solicitud se aparta antes de crear la OT |
| Programación | Cualquier fecha y cualquier estimado | Validación, advertencia de día no laborable y de capacidad, propuesta de días y personas, motivo al reprogramar |
| Backlog | Solo actividades liberadas | Todo el trabajo pendiente por categoría, con origen, motivo, antigüedad y próxima acción |
| Calidad de captura | 98/100 con 24 huecos | Reglas del proceso: penalización triple y doble peso |
| Revisar la semana | Se quedaba en «Revisando…» y cobraba sin entregar | Resultado o error visible; la revisión pagada se reutiliza sin volver a cobrar |

## Reglas de estado y permisos

```
Borrador → Abierta → Asignada → En proceso ⇄ En espera → Completada → Cerrada
                                                   ↘ Cancelada ↗ (reactivar)
Completada → En proceso (devolver, supervisor, con motivo)
Cerrada    → Completada (reabrir, administración, con motivo)
```

| Paso | Quién |
|---|---|
| Iniciar, pausar, reanudar, completar | Técnico en adelante |
| Cerrar y devolver a proceso | Supervisor en adelante |
| Reabrir una cerrada | Administrador y propietario |
| Liberar borrador, cancelar, reactivar | Supervisor en adelante |
| Solicitante y consulta | No mueven órdenes |

## Dónde vive cada cosa

- `lib/reglas-ot.ts` — acciones por estado y rol, permisos, motivos, faltantes de cierre, texto de «sin OT activa» y de inicio sin responsable.
- `lib/workorders.ts` — `transitionWorkOrder`: aplica las reglas y los efectos (paro, planes, avisos), con escritura condicionada al estado leído.
- `lib/solicitudes.ts` — conversión atómica y rechazo con motivo.
- `lib/programacion.ts` — validación, advertencias y propuestas.
- `lib/backlog.ts` — `trabajoPendiente`, el backlog por categorías.
- `lib/saneamiento-ot.ts` — los huecos del proceso, definidos una vez; los leen la calidad de captura y la lista de saneamiento.
- `lib/semana.ts`, `lib/pedir.ts` — qué semana se revisa y peticiones que siempre terminan.

## Pruebas del bloque

| Prueba | Verificaciones |
|---|---|
| `prueba-proceso-ot` | 90 |
| `prueba-revisar-semana` | 21 |
| `prueba-http-inicio-sin-responsable` | 16 (contra el servidor real, con sesión por rol) |

Las dos primeras corren en `npm run actualizar` y lo detienen si fallan.

## Migraciones

- `20260917095217_proceso_operativo_ot` — motivos y excepciones en `WorkOrder`; evidencia obligatoria en `Organization`.
- `20260917120035_revision_agenda_guardada` — tabla `RevisionAgenda`.

Las dos son aditivas y traen su SQL de reversión en el encabezado.

## Lo que queda por revisar a mano (no se tocó)

`./scripts/con-produccion.sh scripts/lista-saneamiento-ot.ts` (solo lectura).
Al cierre: 24 registros en la Demo y 4 en Casa Montemayor. No se inventan horas,
causas, responsables ni paros.
