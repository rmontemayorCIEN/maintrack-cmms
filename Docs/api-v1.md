# API de MainTrack — versión 1

Para sistemas externos: pasarelas de sensores, SCADA, ERP, tableros. La
interfaz de MainTrack usa la sesión de una persona; la API usa una
**credencial** de sistema. Nunca se mezclan.

Base: `https://<su-dirección-de-maintrack>/api/v1`
Índice legible por máquina: `GET /api/v1` (no pide credencial ni da datos).

## Autenticación

Un administrador crea la credencial en **Configuración → Integración → API y
credenciales**, eligiendo solo los permisos necesarios. El secreto tiene la
forma `mt_<prefijo>_<secreto>` y **se muestra una sola vez**.

```
Authorization: Bearer mt_ab12cd34ef_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- La empresa sale de la credencial. Ningún parámetro la cambia: mandar
  `organizationId` o el id de un registro de otra empresa responde
  «no encontrado».
- Revocar corta el acceso en la siguiente petición. Rotar crea una credencial
  nueva con los mismos permisos y revoca la anterior al instante.
- Una credencial puede vencer (se elige al crearla).

### Permisos (alcances)

| Alcance | Permite |
|---|---|
| `activos:leer` | Consultar activos |
| `ubicaciones:leer` | Consultar sitios y ubicaciones |
| `ordenes:leer` | Consultar órdenes (sin nombres de personas) |
| `solicitudes:crear` | Crear solicitudes de trabajo |
| `lecturas:crear` | Lecturas de medidores y condiciones de sensores |
| `inventario:leer` | Existencias por almacén |
| `estado:leer` | Conteos de pendientes |
| `costos:leer` | Agrega costos a activos, órdenes e inventario |
| `eventos:enviar` | Webhook entrante (`/eventos`) |

La API **no expone** usuarios, contraseñas, credenciales, bitácora ni
configuración. Sin `costos:leer` no aparece ningún costo.

## Respuestas y errores

Éxito: JSON con los datos. Error, siempre con la misma forma:

```json
{ "error": { "codigo": "ALCANCE_INSUFICIENTE", "mensaje": "Esta credencial no tiene el permiso «ordenes:leer»." } }
```

| HTTP | Código | Cuándo |
|---|---|---|
| 400 | `JSON_INVALIDO`, `FALTA_IDEMPOTENCIA` | Cuerpo que no es JSON; `/eventos` sin `Idempotency-Key` |
| 401 | `SIN_CREDENCIAL`, `CREDENCIAL_INVALIDA`, `CREDENCIAL_REVOCADA`, `CREDENCIAL_VENCIDA` | |
| 403 | `ALCANCE_INSUFICIENTE`, `EMPRESA_SUSPENDIDA` | |
| 404 | `ACTIVO_NO_ENCONTRADO`, `MEDIDOR_NO_ENCONTRADO`, `SENSOR_NO_ENCONTRADO`, `UBICACION_NO_ENCONTRADA` | También si es de otra empresa |
| 409 | `IDEMPOTENCIA_REUSADA` | La misma clave en otra ruta |
| 422 | `DATOS_INVALIDOS` (con `detalle` por campo), `UNIDAD_INCOMPATIBLE`, `VALOR_NEGATIVO`, `FECHA_FUTURA`, `FECHA_ANTIGUA`, `FUERA_DE_SECUENCIA`, `LECTURA_IMPOSIBLE`, `LECTURA_ATIPICA` | |
| 429 | `LIMITE_ALCANZADO` | Ver límites; trae `Retry-After` |
| 500 | `ERROR_INTERNO` | Reintente; si persiste, avise a soporte |

Todas las respuestas llevan `MainTrack-Version: 1`.

## Límites de uso

Por minuto, en ventanas fijas:

| Límite | Valor |
|---|---|
| Por credencial y ruta | 120 (lecturas y condiciones: 300) |
| Por empresa, todas sus credenciales | 600 |

Encabezados: `X-Limite`, `X-Limite-Restante`, `X-Limite-Reinicio` (segundos
Unix). Al pasarse: `429` con `Retry-After` en segundos. El abuso de una
empresa no le quita cupo a otra. Una credencial que rebasa su límite 50
veces en una hora genera un aviso a los administradores de la empresa.

## Idempotencia

En `POST`, mande `Idempotency-Key: <identificador único>` (hasta 120
caracteres). Repetir la misma clave devuelve **la misma respuesta** con
`Idempotencia-Repetida: true`, sin repetir el efecto. Las claves se guardan
siete días. En `/eventos` es obligatoria.

## Paginación

Listas con cursor: `?limite=50` (máx. 200) y `?cursor=<siguienteCursor>`.
La respuesta trae `datos` y `siguienteCursor` (nulo en la última página).

## Rutas

### `GET /activos` — `activos:leer`
Filtros: `q` (código, nombre o serie), `sitio` (código), `estado`
(`OPERATIONAL`, `DEGRADED`, `DOWN`, `STANDBY`, `RETIRED`).
```json
{ "datos": [{ "id": "…", "codigo": "BOM-101", "nombre": "Bomba", "criticidad": "A", "estado": "OPERATIONAL",
  "fabricante": "Grundfos", "modelo": "CR-15", "serie": "SN-1", "sitio": { "codigo": "P01", "nombre": "Planta" },
  "ubicacion": { "codigo": "NAV-1", "nombre": "Nave 1" }, "actualizado": "2026-09-18T14:00:00.000Z" }],
  "siguienteCursor": null }
```

### `GET /ubicaciones` — `ubicaciones:leer`
Sitios con sus ubicaciones (`id`, `codigo`, `nombre`, `padre`).

### `GET /ordenes` — `ordenes:leer`
Filtros: `estado`, `desde` (ISO 8601, sobre la última actualización),
`activo` (código). Campos: `folio`, `titulo`, `tipo`, `estado`,
`prioridad`, `activo`, `sitio`, `vence`, `creada`, `iniciada`, `terminada`,
`cerrada`; `costoTotal` solo con `costos:leer`.

### `POST /solicitudes` — `solicitudes:crear`
```json
{ "titulo": "Ruido en bomba", "descripcion": "…", "activo": "BOM-101", "ubicacion": "NAV-1", "prioridad": "HIGH" }
```
Obligatorio: `titulo`. `prioridad`: `LOW | MEDIUM | HIGH | CRITICAL`. Queda a
nombre de la integración y avisa a quien revisa solicitudes. Responde `201`
con `id`, `folio`, `estado`.

### `POST /lecturas` — `lecturas:crear`
Lectura de un medidor (horas, km, ciclos):
```json
{ "medidor": "<id>", "valor": 12640, "unidad": "h", "fecha": "2026-09-18T08:30:00-06:00" }
```
o bien `"activo": "CMP-301", "nombre": "Horómetro principal"` en lugar de
`medidor`. Pasa por las **mismas reglas que la captura en pantalla**:

- Fecha con zona, no futura y no más vieja de un año (sin `fecha`: ahora).
- Unidad, si se manda, igual a la del medidor (no se convierte).
- Ni negativa, ni menor que la anterior (`FUERA_DE_SECUENCIA`), ni imposible
  para el tipo (un horómetro no suma más horas que el reloj).
- Lo atípico (muy por encima del uso promedio) se rechaza con
  `LECTURA_ATIPICA`: por la API no hay quién lo justifique.
- La misma lectura repetida (mismo medidor, mismo instante, mismo valor)
  responde `200` con `duplicada: true` y no se duplica.
- Una lectura rechazada genera un aviso a supervisión.

La lectura adelanta los planes por uso según las reglas del sistema; nunca
modifica una orden ni un plan directamente.

### `POST /condiciones` — `lecturas:crear`
Lectura de un sensor de condición (temperatura, vibración, presión…):
```json
{ "sensor": "<id>", "valor": 78.4, "unidad": "°C", "fecha": "2026-09-18T08:30:00-06:00" }
```
Evalúa umbrales y tendencia; puede abrir una alerta predictiva. Duplicados
igual que en lecturas.

### `GET /inventario` — `inventario:leer`
Filtro `q`. Existencia total y `porAlmacen`; `costoUnitario` con `costos:leer`.

### `GET /estado` — `estado:leer`
Conteos: órdenes abiertas, críticas y vencidas, solicitudes pendientes,
alertas abiertas y equipos detenidos.

### `POST /eventos` — webhook entrante — `eventos:enviar`
Para sistemas que prefieren un solo punto de entrada:
```json
{ "tipo": "lectura", "datos": { "medidor": "<id>", "valor": 12640 } }
```
`tipo`: `solicitud` (requiere además `solicitudes:crear`), `lectura` o
`condicion` (requieren `lecturas:crear`). `datos` es exactamente el cuerpo de
la ruta correspondiente. Exige `Idempotency-Key`.

## Webhooks salientes

Se configuran en **Configuración → Integración → Webhooks**: nombre, dirección
`https://` pública y los eventos a recibir. No se aceptan direcciones
internas, IPs, `localhost`, dominios `.local`/`.internal` ni direcciones que
resuelvan a redes privadas o al servidor de metadatos; se revisa al guardar y
antes de cada envío.

Cada envío es un `POST` JSON:
```json
{ "id": "evt_4f…", "tipo": "OT_CRITICA_CREADA", "ocurrio": "2026-09-18T14:00:00.000Z", "prioridad": "CRITICA",
  "registro": { "tipo": "WorkOrder", "id": "…" }, "titulo": "OT crítica OT-000123 · CMP-301", "datos": { "folio": "OT-000123" } }
```
`datos` lleva solo identificadores y estados (folio, prioridad), nunca datos
personales.

Encabezados:

| Encabezado | Contenido |
|---|---|
| `MainTrack-Evento-Id` | Identificador único del evento (igual a `id`) |
| `MainTrack-Evento` | Tipo de evento |
| `MainTrack-Marca` | Segundos Unix del envío |
| `MainTrack-Firma` | `v1=` + HMAC-SHA256 hex de `"<marca>.<cuerpo>"` con el secreto del webhook |

### Verificar la firma

1. Recalcule `HMAC-SHA256(secreto, marca + "." + cuerpo_crudo)` y compárelo en
   tiempo constante con lo que sigue a `v1=`.
2. Rechace marcas con más de 5 minutos de diferencia.
3. Guarde los `MainTrack-Evento-Id` recibidos de los últimos minutos y
   descarte repeticiones.

```js
const crypto = require("node:crypto");
function valida(secreto, marca, cuerpo, firma) {
  if (Math.abs(Date.now() / 1000 - Number(marca)) > 300) return false;
  const esperada = "v1=" + crypto.createHmac("sha256", secreto).update(`${marca}.${cuerpo}`).digest("hex");
  return esperada.length === firma.length && crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma));
}
```

### Reintentos

Responda `2xx` en menos de 8 segundos. Cualquier otra respuesta o la falta
de respuesta se reintenta con espera creciente: 1, 5, 30 minutos, 2 y 6 horas
(máximo 5 intentos). Un `4xx` distinto de `408`/`429` se toma como rechazo
definitivo y no se reintenta. Tras **10 fallas seguidas** el webhook se
suspende y se avisa a los administradores; al reactivarlo la cuenta vuelve a
cero. Cada intento queda en el historial de entregas. Con «Probar» se manda un
evento `PRUEBA` con datos inventados.

### Eventos disponibles

`OT_ASIGNADA`, `OT_REASIGNADA`, `OT_PRIORIDAD_CAMBIADA`, `OT_CRITICA_CREADA`,
`OT_VENCIDA`, `OT_DETENIDA`, `OT_LISTA_REVISION`, `OT_DEVUELTA`, `OT_CERRADA`,
`SOLICITUD_NUEVA`, `SOLICITUD_CONVERTIDA`, `SOLICITUD_RECHAZADA`,
`PLAN_FALLO_GENERAR`, `PREVENTIVO_INCUMPLIDO`, `UMBRAL_CERCA`,
`UMBRAL_EXCEDIDO`, `LECTURA_ANORMAL`, `ALERTA_PREDICTIVA`,
`CONDICION_NORMALIZADA`, `REFACCION_BAJO_MINIMO`, `REFACCION_CRITICA_AGOTADA`,
`REQUISICION_POR_AUTORIZAR`, `REQUISICION_RESUELTA`, `ENTREGA_VENCIDA`,
`RECEPCION_PARCIAL`. La lista viva está en `GET /api/v1` (`eventosDeWebhook`).

## Versionado

La versión va en la ruta (`/api/v1`). Dentro de una versión solo se agregan
campos y rutas; nada se quita ni cambia de significado. Un cambio
incompatible sería `/api/v2`, con `v1` vigente durante la transición.
