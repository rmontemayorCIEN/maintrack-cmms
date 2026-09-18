# Bloque 5 — Avisos, escalamiento e integraciones

Que MainTrack avise, recuerde y escale sin depender de que alguien entre a
revisar, que cada persona reciba solo lo suyo, y que otros sistemas se
conecten de forma segura y aislada por empresa.

## Diagnóstico inicial

| Hallazgo | Consecuencia |
|---|---|
| 19 lugares llamaban a `notify()` con título libre y un `kind` de cuatro valores. Sin catálogo, sin tipo, sin registro relacionado | No se podía filtrar, atender ni deduplicar nada |
| Casi todo iba a dueño + administrador + supervisor juntos: solicitudes, reportes del portal, stock mínimo, alerta crítica, requisición de compra (incluida quien la pidió) | El administrador como destinatario universal; ruido para todos |
| De seis flujos que crean órdenes, solo dos avisaban la asignación (alta manual y programador). El armador, la solicitud convertida, el predictivo y la agenda, no | Órdenes asignadas de las que el técnico no se enteraba |
| No existían avisos de vencimientos, OT crítica, detenida, lista para revisión, devuelta, compras vencidas, medidores sin lectura, planes sin programación, equipos críticos sin plan, fin de prueba, límites, usuarios, contraseñas ni importaciones | Todo eso dependía de que alguien abriera la pantalla correcta |
| `notify()` no revisaba si la persona estaba activa | Un usuario desactivado seguía recibiendo |
| Sin deduplicación: el stock mínimo avisaba en cada consumo por debajo; las atrasadas se deduplicaban por título y día | Avisos repetidos |
| El aviso al celular era un solo intento, sin historial; no había correo | Fallas silenciosas |
| El programador de preventivos corría todas las empresas en un ciclo sin captura de errores | Una excepción cortaba la corrida de todas, sin avisar |
| «Integración» en Configuración listaba rutas que exigen sesión de una persona; la ingesta de sensores pedía sesión de técnico | No había forma real de integrar: ni credenciales, ni webhooks, ni límites |
| El `CRON_SECRET` es de la plataforma (correcto para tareas programadas); no había credenciales por empresa | — |

Procesos programados existentes (Cloud Scheduler): preventivos cada hora,
trabajo disponible cada 30 minutos, diagnóstico de IA semanal.

## Arquitectura

```
flujo (asignar, pedir compra…) ─┐
proceso programado (detectores) ─┼─► emitirAviso(evento) ─► destinatarios ─► notify() ─► Notification (campana)
escalamiento ────────────────────┘        │                                     └─► EntregaAviso (navegador, correo)
                                          └─► EntregaAviso (webhooks de la empresa)
cola: /api/cron/avisos ─► procesarEntregas ─► canales ─► historial + reintentos
```

- `lib/avisos/catalogo.ts` — los 47 eventos: módulo, prioridad, clase
  (obligatorio / operativo / informativo), si pide acción, a quién.
- `lib/avisos/destinatarios.ts` — la matriz, en un solo lugar.
- `lib/avisos/emitir.ts` — emitir un evento, atenderlo, reconocerlo.
- `notify()` (`lib/audit.ts`) sigue siendo la **única puerta** (regla 8):
  persona activa y de la empresa, preferencias, deduplicación, campana
  primero y canales después. Delega en `lib/avisos/entrega.ts`.
- `lib/avisos/detectores.ts`, `escalamiento.ts`, `resumenes.ts`,
  `proceso.ts` — lo que corre solo.
- `lib/avisos/ordenes.ts` — los avisos de órdenes, llamados con una línea
  desde los seis flujos que crean órdenes y los dos que las cambian.

## Eventos

**Órdenes:** asignada, reasignada, cambio importante de prioridad, crítica,
por vencer, vencida, sin aceptar (escalamiento), detenida, lista para
revisión, devuelta en revisión (también «información o evidencia
solicitada»), cerrada.
**Solicitudes:** nueva, convertida, rechazada, crítica sin atender.
**Preventivo:** falló la generación, plan sin programación válida, equipos
críticos sin plan (agrupado), preventivo incumplido.
**Medidores y predictivo:** cerca del umbral, umbral excedido, lectura anormal
(proyección suspendida o rechazada por la API), medidores sin lectura en 7
días (agrupado), alerta predictiva, alerta crítica sin reconocer, condición
normalizada.
**Almacén y compras:** refacciones bajo mínimo (agrupado), refacción crítica
agotada, compra por autorizar, compra autorizada/rechazada, autorizada sin
orden de compra, entrega próxima, entrega vencida, recepción parcial.
**Administración:** usuario nuevo, desactivado, cambio de rol, contraseña
cambiada, prueba por terminar, límite del plan cerca y alcanzado,
integración con errores, importación completada/fallida/bloqueada, aviso sin
destinatario.
**Resúmenes:** diario y semanal.

Decisiones de alcance:

- «Aceptar» una orden = iniciarla, o decir «Enterado» en su aviso. No se
  agregó un paso nuevo de aceptación al flujo de la orden.
- «Solicitud clasificada» no se avisa por separado: una solicitud se revisa
  una vez (convertida o rechazada), y eso sí se avisa.
- «Requisición» y «compra» son la misma solicitud de compra en MainTrack; la
  requisición de almacén no lleva autorización.
- «Plan por uso que debería generar»: lo cubre el programador; si no puede,
  el plan aparece como «sin programación válida» con el motivo.
- «Movimiento que requiera revisión» y «diferencia entre lo solicitado,
  comprado y recibido»: cubiertos por recepción parcial (renglón por renglón).
- «Respaldo fallido»: no hay dónde leerlo desde la aplicación; queda fuera.

## Matriz de destinatarios

Grupos en cadena: recibe el primero con alguien activo; los demás son
respaldo, no copia.

| Grupo | Quién |
|---|---|
| Responsable | El asignado del registro |
| Supervisores | Rol supervisor, filtrado por sus sitios de interés (si el filtro deja a nadie, todos) |
| Revisores | Quien puede revisar solicitudes, empezando por supervisores |
| Autorizadores | Quien puede autorizar compras, **excepto quien la pidió** |
| Almacén | Responsable del almacén y rol compras |
| Compras | Rol compras |
| Administradores | Los elegidos en Configuración → Avisos; si no hay, dueño y administradores |
| Propietario | Dueño de la cuenta |
| Solicitante / persona afectada | Quien pidió; la persona de quien se habla |

Reglas: solo personas activas de la misma empresa; desactivada = no recibe y
queda «sin destinatario válido»; si nadie califica, queda registrado qué
falta y se vuelve un pendiente administrativo (uno por tipo y faltante, no uno
por registro).

## Canales

Centro de avisos (siempre), navegador/celular (si la empresa lo encendió, la
persona lo activó y no negó el permiso), correo (si hay proveedor) y webhook.
Cada canal es independiente: si uno falla, la operación se completa, la
campana conserva el aviso, el error queda en el historial y se reintenta. El
permiso del navegador solo se pide con el botón; si se niega, se guarda y no
se intenta ese canal.

**Correo:** no hay proveedor autorizado. El canal está completo (cola,
reintentos, historial) y el transporte se enchufa en `lib/avisos/canales.ts`.
Sin proveedor configurado el canal aparece «no disponible» y no se crean
entregas de correo.

## Prioridad

Parte de la del evento y se ajusta con reglas fijas (`lib/avisos/prioridad.ts`):
prioridad del registro, criticidad A (+1), seguridad (crítica), equipo parado
por falta de material, horas vencida (+1, **crítica solo si la orden es
crítica o el equipo es A**), monto, reincidencia y tiempo sin atención (+1
hasta «alta», nunca «crítica»). Cada aviso dice qué pasó, por qué importa,
desde cuándo, quién debe actuar y qué hacer.

## Recordatorios y escalamiento

| Regla | Espera | Jornada | Primero | Luego | Recordatorios | Se detiene |
|---|---|---|---|---|---|---|
| OT crítica sin aceptar | 30 min | 24 h | responsable | supervisores + administración | 2 | iniciada, «Enterado», reasignada, cerrada |
| OT alta sin aceptar | 4 h | sí | responsable | supervisores | 1 | igual |
| OT vencida sin movimiento | 8 h | sí | responsable | supervisores | 2 | terminada, cancelada, reprogramada a fecha futura; un movimiento válido reinicia la espera |
| Solicitud crítica sin revisar | 30 min | 24 h | revisores | administración | 2 | revisada |
| Compra sin autorizar | 8 h (1 h con equipo parado) | sí | autorizadores | dueño | 2 | autorizada, rechazada |
| Alerta crítica sin reconocer | 1 h | 24 h | supervisores | administración | 2 | reconocida, resuelta |
| Refacción crítica agotada | 8 h | sí | almacén | supervisores | 1 | repuesta |
| Compra vencida sin recepción | 8 h | sí | compras | autorizadores | 2 | recibida, cancelada |

Un recordatorio vuelve a entregar la MISMA notificación («recordado 2
veces»). Subir de nivel queda en la bitácora. Cambiar de responsable reinicia
el escalamiento para la persona nueva. Cada empresa ajusta espera,
recordatorios, jornada o apaga una regla.

## Cuándo un aviso queda atendido

Un aviso que pide acción se atiende cuando la **condición que lo originó deja
de existir**, no cuando alguien hace algo con el registro. La regla de cada
tipo —cuándo nace, permanece, se actualiza, escala y se atiende, y la función
que lo decide leyendo el estado real— vive en un solo lugar:
`REGLAS_DE_AVISO` en `lib/avisos/condiciones.ts`. Hay una por cada uno de los
30 tipos que piden acción y una por cada regla de escalamiento.

**Leído, enterado y atendido son tres cosas distintas:**

| | Qué es | Qué cambia |
|---|---|---|
| Leído | La persona lo abrió | Deja de contar como no leído. Nada más |
| «Enterado» | La persona dice que ya lo vio | Lo marca leído y detiene el escalamiento en las reglas donde reconocer basta (OT sin aceptar, alerta crítica sin reconocer). **No lo atiende** |
| Atendido | La condición ya no existe | Sale de pendientes, cancela sus entregas por salir y queda su motivo |

**Reconciliación.** `reconciliar()` compara cada aviso abierto con su
registro y atiende solo los que se resolvieron, con un motivo que dice qué
pasó («La OT fue terminada», «La fecha compromiso se cambió a una fecha
futura (23 sep 2026)», «La requisición fue autorizada», «La existencia se
repuso: 2 pza»). La llaman los flujos en el momento (cambio de estado,
edición, autorización, recepción, conversión o rechazo de solicitud,
acciones sobre alertas) y el proceso programado cada cinco minutos, que
corrige lo que haya quedado inconsistente. Si una persona tiene dos avisos
abiertos de la misma condición sobre el mismo registro, deja uno.

**Una condición, un aviso.** La OT vencida que se reprograma a otra fecha que
también ya pasó sigue vencida: se actualiza el mismo aviso con la fecha
nueva, no se abre otro. Si la condición se resuelve y vuelve (se reprogramó a
futuro y otra vez venció), se reabre el mismo aviso como ciclo nuevo.

**Vencida y sin movimiento son dos condiciones.** El recordatorio «OT vencida
sin movimiento» se atiende con movimiento válido aunque la OT siga vencida; el
aviso «OT vencida» sigue hasta que deja de estarlo. Movimiento válido
(`lib/avisos/movimiento.ts`): inicio, actividad hecha o liberada, horas de
mano de obra, material cargado, cambio de estado o reprogramación con motivo
a fecha futura. No cuentan: abrir, leer, «Enterado», comentar, editar otro
campo, guardar sin cambios, cambiar el responsable ni cambiar algo y
regresarlo en menos de diez minutos.

**Reasignación.** Se cierra el aviso del responsable anterior («La OT se
reasignó a …»), el responsable nuevo recibe el suyo en el momento, y el de
supervisión sigue mientras la OT siga vencida.

**Historial.** Cada cambio de pendiente a atendido, y cada reapertura, queda
en `HistorialAviso`: fecha, condición anterior y actual, evento que lo
resolvió, quién actuó, qué proceso lo confirmó (flujo, reconciliación o
programador) y el motivo mostrado. No se repite en la bitácora general.

Revisar datos reales sin escribir: `./scripts/con-produccion.sh
scripts/reconciliar-avisos.ts --folio OT-000001` (con `--aplicar`, corrige).

## Preferencias

Cada persona elige canales, tipos de aviso, resúmenes, su horario para lo no
crítico y, si supervisa, sus sitios. **No se pueden apagar:** los obligatorios
(OT crítica, sin aceptar, umbral excedido, alerta crítica, falla del
programador, solicitud crítica, contraseña, rol, límites, prueba,
integración con errores, configuración incompleta); y ningún aviso que pida
acción cuando la persona es el responsable directo de algo alto o crítico, o
la única que puede atenderlo. Lo apagado queda «omitido por preferencia».

## Resúmenes

Diario (días laborables, 7:30 en la zona de la empresa) y semanal (primer día
laborable, la semana anterior completa). Por rol: el técnico ve sus órdenes
críticas, vencidas, por vencer y preventivos del día; supervisión la
operación (críticas, vencidas, solicitudes sin revisar, preventivos de hoy,
alertas, escalados, refacciones críticas); quien autoriza, las compras que
esperan su firma; compras, lo que hay que colocar o perseguir. El semanal
compara contra la semana previa (cambios de ±20% y al menos 3), cumplimiento
preventivo, trabajo planeado, tiempo de atención, equipos con más fallas y
consumo (solo roles con acceso a costos). Sin secciones vacías; si no hay
nada, no se manda (salvo que la empresa pida el «sin pendientes»). Todo
calculado en código, sin IA.

**Un registro, una vez.** Antes de armar el resumen se juntan todas las
apariciones de cada registro (`consolidar()` en `lib/avisos/resumenes.ts`):
la misma OT puede salir como propia, como del equipo y como escalada si la
persona es responsable, supervisora y dueña. Queda en la sección más
específica, con la prioridad más alta, la acción de esa sección y todas sus
etiquetas («crítica · vencida · escalado»). Orden de clasificación:

1. Requiere una acción directa suya → **Mis pendientes**
2. Es responsabilidad directa suya → **Mis pendientes**
3. Requiere su autorización → **Pendientes que debo autorizar**
4. Es del equipo o área que supervisa → **Pendientes de mi equipo**
5. Es situación general de la empresa → **Situaciones generales de la empresa**
6. Es solo informativo → **Información relevante**

Registros distintos siguen separados: la alerta predictiva y la OT que
generó son dos renglones. El semanal pasa por `sinRepetir()`.

## Entrega, reintentos y deduplicación

`EntregaAviso` registra cada intento: empresa, destinatario, evento, canal,
programada, intentada, resultado, número de intento, proveedor, categoría y
detalle del error (sin contenido ni secretos), próximo reintento y entrega.
Estados: pendiente, en proceso, entregada, fallida, en reintento, cancelada,
omitida por preferencia, sin destinatario válido.

- Identificador de evento determinista (`evt_…`): el mismo para todos sus
  destinatarios y canales.
- Clave de deduplicación: empresa + tipo + registro + versión + destinatario
  (+ canal en la entrega). Mismo problema = una notificación que se
  actualiza; cambia la versión (otro responsable, otra fecha, otro nivel) =
  aviso nuevo.
- Toma atómica (pendiente → en proceso) para que dos procesos no manden lo
  mismo; una entrega colgada más de 15 minutos regresa a la cola.
- Reintentos: 1, 5, 30 min, 2 y 6 h; máximo 5. Falla permanente no se
  reintenta. Reintento manual para administradores, en la bitácora.
- Lo resuelto antes de enviarse se cancela. Lo no crítico fuera de horario
  espera a que abra la ventana.
- Agrupados: refacciones bajo mínimo, equipos críticos sin plan, medidores
  sin lectura.

## API

Rutas `/api/v1`, separadas de la interfaz: `activos`, `ubicaciones`,
`ordenes`, `solicitudes`, `lecturas`, `condiciones`, `inventario`, `estado`,
`eventos` (webhook entrante). Documentación completa: `Docs/api-v1.md`.

Credenciales por empresa (`CredencialApi`): nombre, alcances, creación,
último uso, usos, vencimiento, estado, rotación y revocación inmediata. El
secreto se muestra una vez; se guarda solo su huella SHA-256; nunca va a la
bitácora ni vuelve al navegador. Cada llamada queda en `UsoApi` (sin cuerpo).

**Webhooks salientes**: por empresa, eventos elegidos, firma HMAC-SHA256 con
marca de tiempo e identificador de evento, reintentos, suspensión tras 10
fallas seguidas (con aviso), prueba de conexión sin datos reales e historial.
Destinos: solo `https` públicos; se rechazan internos, IPs, metadatos y redes
privadas, al guardar y antes de cada envío. El secreto de firma se guarda
cifrado (AES-256-GCM).

**Lecturas externas**: la empresa sale de la credencial; medidor y sensor se
buscan dentro de ella; unidad igual a la del medidor; fecha con zona, no
futura; misma validación que la captura (`registrarLectura`); duplicadas no se
duplican; fuera de secuencia o imposibles se rechazan y avisan; lo atípico no
se acepta por la API. Nada externo modifica una orden o un plan directamente.

**Límites**: 120 por minuto por credencial y ruta (300 en lecturas), 600 por
empresa; contadores en base de datos (varias instancias de Cloud Run),
aislados por empresa; `429` con `Retry-After`; 50 rechazos por límite en una
hora avisan a los administradores. Correo: 300 por empresa por hora (lo que
no cabe espera, no se pierde). Webhooks: 120 eventos por minuto por webhook.

## Permisos y aislamiento

Configurar canales, reglas, resúmenes, destinatarios, credenciales, webhooks,
ver el historial técnico y reintentar: `settings:write` (dueño y
administrador). Las preferencias son de cada persona. Toda consulta filtra por
la empresa de la sesión o de la credencial; un aviso, credencial, webhook o
entrega de otra empresa responde 404.

El operador de la plataforma ve en su consola el estado técnico por empresa
(entregas fallidas, en cola, webhooks, credenciales, errores de API): solo
conteos, sin contenido.

## Bitácora

`NOTIFICATION_PREFERENCES_CHANGED`, `NOTIFY_CHANNELS_CHANGED`,
`ESCALATION_RULES_CHANGED`, `ADMIN_RECIPIENTS_CHANGED`,
`SUMMARY_CONFIG_CHANGED`, `NOTIFY_CONFIG_CHANGED`, `API_KEY_CREATED`,
`API_KEY_ROTATED`, `API_KEY_REVOKED`, `WEBHOOK_CREATED`, `WEBHOOK_UPDATED`,
`WEBHOOK_SECRET_ROTATED`, `WEBHOOK_TESTED`, `DELIVERY_RETRIED`,
`ESCALATION_RAISED`, `ESCALATION_ACKNOWLEDGED`, `INTEGRATION_SUSPENDED`. Los
intentos automáticos de entrega van al historial técnico, no a la bitácora.

## Variables de entorno

| Variable | Para qué | Producción |
|---|---|---|
| `CRON_SECRET` | Protege `/api/cron/avisos` (ya existe) | Ya está |
| `APP_URL` | Ligas absolutas en los correos | Agregar cuando haya correo |
| `LLAVE_INTEGRACIONES` | Llave AES de 32 bytes (base64) para los secretos de webhooks. Opcional: si falta se deriva de `AUTH_SECRET` | Recomendada, en Secret Manager |
| `AVISOS_CORREO` | Transporte de correo. Hoy solo `prueba`, que **se ignora en producción** | No poner |
| `AVISOS_WEBHOOK_PERMITIR_LOCAL` | Receptor local de pruebas. Se ignora en producción | No poner |

**Tarea programada nueva:** `GET /api/cron/avisos` cada 5 minutos con
`Authorization: Bearer $CRON_SECRET` (job de Cloud Scheduler por crear).

## Pruebas

| Prueba | Cubre |
|---|---|
| `prueba-avisos.ts` | Las 45 obligatorias, en tres empresas exclusivas; nada sale a la calle (correo de prueba, navegador simulado, receptor de webhooks local). Al final comprueba que las demás empresas quedaron idénticas |
| `prueba-avisos-atendidos.ts` | Resúmenes sin repetidos (10) y avisos atendidos solo por resolución real (20), más el caso de producción de OT-000001 y OT-000004; edición, «Enterado» y alertas por HTTP contra la ruta real |

## Migración

`20260918090022_avisos_e_integraciones` — aditiva: columnas nuevas de
`Notification` y tablas `EntregaAviso`, `PreferenciaAvisos`, `ConfigAvisos`,
`Escalamiento`, `CredencialApi`, `UsoApi`, `Webhook`, `ClaveIdempotencia`,
`LimiteUso`.

`20260918123130_historial_de_avisos` — aditiva: tabla `HistorialAviso`.

## Riesgos y pendientes reales

- **Primera corrida en empresas existentes.** Al encender el proceso, todo lo
  vencido o pendiente de hoy se avisa de golpe (una vez por problema, gracias
  a la deduplicación) y los escalamientos de órdenes vencidas hace tiempo
  empiezan con su primer recordatorio pendiente. Conviene revisar los conteos
  antes de crear el job de Cloud Scheduler.
- **Correo sin proveedor.** Hace falta elegir y autorizar uno (SMTP de Google
  Workspace o un servicio de envío) y un dominio verificado.
- **Turnos.** No existe un modelo de turnos: la ventana de avisos es la
  jornada de la empresa (o la de cada persona en sus preferencias).
- **Resolución DNS.** El destino de un webhook se valida antes de cada envío,
  pero entre la validación y la conexión un dominio podría cambiar de
  dirección (rebinding). Riesgo bajo; se mitigaría fijando la dirección
  resuelta en la conexión.
- **Llave de integraciones.** Si falta `LLAVE_INTEGRACIONES`, la de webhooks
  se deriva de `AUTH_SECRET`: rotar esa variable obliga a regenerar los
  secretos de los webhooks.
- **La orden de compra no cambia de estado al recibir.** La recepción
  actualiza la requisición (parcial, recibida), no `PurchaseOrder.estado`,
  que se queda «ABIERTA». Los avisos leen la requisición para no quedarse
  abiertos; la pantalla de compras que muestre el estado de la orden de
  compra lo seguirá viendo abierta.
- **Avisos de abuso de credenciales.** Se atienden al revocar la
  credencial; si la integración simplemente deja de rebasar su límite, el
  aviso sigue abierto hasta revisarlo.
- **Historial.** Las notificaciones y entregas no se purgan solas (no se
  borra información). Crecerán; una política de retención queda por decidir.
