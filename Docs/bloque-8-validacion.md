# Bloque 8 — Validación integral, piloto controlado y preparación para salida

Auditoría del 20 de septiembre de 2026. Primero se auditó sin tocar nada; la
corrección vino después y solo sobre defectos comprobados.

**Recomendación: listo con condiciones.** Las condiciones están al final.

---

## Cómo se auditó

| Frente | Cómo |
|---|---|
| Funcional | Inventario de las 63 pruebas existentes contra los flujos que pide el bloque |
| Seguridad | Revisión de sesiones, rutas, límites, archivos, entradas, errores y secretos, archivo por archivo |
| Concurrencia | Los nueve escenarios del bloque, buscando en el código la protección concreta de cada uno |
| Observabilidad | Qué se registra, qué avisa y qué está configurado en Google Cloud (consultado por API, de solo lectura) |
| Rendimiento | Índices, consultas N+1, agregados en memoria y paginación, contra el volumen que traerá un piloto |
| Datos de producción | Consultas de solo lectura a la base real |

Lo que **no** se pudo auditar y por qué está en «Pendientes».

---

## Hallazgos

Estado: **Corregido** (con prueba de regresión) · **Verificado** (se comprobó
que ya estaba bien) · **Pendiente manual** · **Bloqueado** · **Fuera de alcance**.

### Bloqueantes

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **La búsqueda estaba rota en producción.** Las listas usaban `contains` sin `mode: "insensitive"`. SQLite es insensible a mayúsculas por omisión y PostgreSQL no: en la Mac «bomba» encontraba «Bomba»; en producción no encontraba nada. Ninguna prueba local podía verlo | Corregido |
| 2 | **Se podían duplicar órdenes preventivas.** Ningún cron tenía candado y el programador decidía contra una lectura del inicio del barrido para escribir mucho después. Dos corridas solapadas generaban dos OT idénticas, con dos avisos, y al cerrar la segunda el plan avanzaba dos veces | Corregido |
| 3 | **Crear OT y crear requisición de material no tenían defensa de servidor contra el doble envío.** Solo el botón deshabilitado del navegador, que no sobrevive a un reintento de red ni a una segunda pestaña | Corregido |
| 4 | **La IA entregaba lo que la pantalla oculta.** Las herramientas recibían la empresa pero nunca el rol: un técnico o un solicitante obtenían en prosa los costos que el sistema les esconde en todas las pantallas. Cuatro rutas de IA además no comprobaban el rol | Corregido |
| 5 | **Tres listas mostraban cifras incorrectas.** Traían un tope de registros y filtraban después, en memoria: con 500 vencidas la lista no las tenía todas, la refacción bajo mínimo en el lugar 350 no aparecía nunca, y «Solicitadas (12)» eran doce de las trescientas que cupieron | Corregido |
| 6 | **La restauración nunca se había probado** | Corregido — ver «Evidencia de restauración» |
| 7 | **No hay forma de enterarse de una falla nocturna.** Cero alertas en Google Cloud, ningún cron detectaba que dejó de correr, y las cuatro rutas respondían 200 aunque por dentro hubieran fallado | Parcial: los cron ya responden 500 y queda registro de cada corrida, visible en la consola del operador. **Faltan las alertas de Google Cloud** |

### Altos

| # | Hallazgo | Estado |
|---|---|---|
| 8 | Novena cuenta en la empresa demostrativa de producción, creada a mano, que contradecía la guía | Corregido: desactivada, no borrada |
| 9 | El cierre de OT libera las solicitudes **antes** del candado de estado: quien pierde la carrera las deja sueltas | Pendiente |
| 10 | `lib/api.ts` devuelve el mensaje crudo de cualquier excepción al cliente con 500, incluidos los de Prisma con nombre de modelo y campos | Pendiente |
| 11 | Los adjuntos validan el tamaño **declarado**, no el real tras subir a Google Cloud Storage | Pendiente |
| 12 | El logotipo admite SVG y se sirve como `image/svg+xml` desde el propio origen | Pendiente |
| 13 | El límite de solicitudes públicas vive en memoria del proceso: con diez instancias son 50/hora, no 5 | Pendiente |
| 14 | **No existe ninguna prueba de volumen**, así que todo el diagnóstico de rendimiento son estimaciones razonadas sobre el código, no mediciones | Pendiente |
| 15 | Rendimiento: búsqueda global que trae 20 000 filas y filtra en memoria; `calcularIndicadores` con cinco consultas sin tope que alimenta cinco pantallas; faltan índices compuestos en las tablas que crecen; `DowntimeEvent` es el único modelo grande sin `organizationId` | Pendiente |
| 16 | Los resúmenes diarios hacen ~500 consultas secuenciales con 40 usuarios, y comparten el grupo de conexiones con las pantallas | Pendiente |

### Medios y bajos

Idempotencia de la API v1 verificada contra reintentos secuenciales pero no
concurrentes; el cierre de OT no es transaccional (si el proceso muere a
medias, la orden queda cerrada con los relojes del plan sin avanzar); el
armador manual revalida y crea sin transacción; el control de sobre-recepción
está fuera de la transacción; el freno de acceso cuenta por correo y no por
IP; los `AccessAttempt` no se purgan; la cookie del portal se firma con la
misma llave que la sesión; `misSolicitudes` corta a 400 antes de filtrar por
teléfono.

### Lo que ya estaba bien (verificado, no se tocó)

- **Aislamiento entre empresas.** 42 modelos con `organizationId`, toda
  consulta filtrada, 24 intentos de cruce en `prueba-aislamiento` y 28 más en
  `prueba-comercial`. Entrar a una empresa cliente queda en la bitácora.
- **Sesiones.** Revocación por `sessionsValidFrom` al cambiar contraseña, rol
  o desactivar; suplantación revalidada contra la base en cada petición.
- **Recuperación de acceso.** Token de 32 bytes guardado solo como hash, 60
  minutos, un solo uso con escritura condicional.
- **API externa v1.** Credencial con huella comparada en tiempo constante,
  organización tomada de la credencial, alcances por ruta, doble límite en
  base, idempotencia y errores genéricos hacia afuera.
- **Folios.** Incremento atómico en el `UPDATE` más índice único por empresa:
  dos peticiones simultáneas no pueden colisionar.
- **Inventario.** `aplicarMovimiento` con escritura condicional sobre la
  existencia: dos consumos simultáneos de la última pieza no pueden dejarla
  negativa, en ninguno de los dos motores.
- **Cola de avisos y webhooks.** Reintentos con espera progresiva, toma
  condicional, deduplicación, identificador de evento estable entre reintentos
  y suspensión automática tras diez fallas.
- **Secretos.** Ninguno en el repositorio, y `.env` nunca estuvo en el
  historial de git.

---

## Pruebas automatizadas

65 pruebas. Las que agregó o amplió este bloque:

| Prueba | Qué protege |
|---|---|
| `prueba-bloque-8.ts` (nueva) | Que ninguna búsqueda use `contains` a pelo y que el ayudante se comporte bien en los **dos** motores, cada uno en su proceso; que dos corridas simultáneas del programador generen una sola orden; que un candado vencido se pueda retomar y que una corrida fallida quede marcada; que ninguna herramienta de IA devuelva importes a un rol que no los ve; que el filtro de vencidas de la base no pierda ninguna de las que la pantalla marca vencidas; que el bajo mínimo salga aunque quede al final de la lista |
| `prueba-experiencia.ts` (ampliada) | Crear una orden y crear una requisición dos veces seguidas dejan una de cada una (201 + 409) |
| `verificar-restauracion.ts` (nueva) | Conteos, relaciones, kardex, usuarios con su rol, empresas con su plan, adjuntos y bitácora de una base restaurada, comparados contra producción |

**Cómo se comprobó que las pruebas sirven:** se quitó el candado del
programador a propósito y la prueba falló con dos órdenes; se volvió a poner y
pasó con una. La depuración de costos de la IA se escribió primero con una
lista de nombres y la prueba encontró dos campos que se escapaban, lo que
obligó a cambiarla por un patrón.

**Correr todo:**

```bash
npx tsc --noEmit
for f in scripts/prueba-*.ts; do npx tsx "$f"; done
npm run build
```

Las seis `*-real` necesitan `ANTHROPIC_API_KEY` (van con
`./scripts/con-produccion.sh`). `prueba-avisos` depende de la hora del día.

---

## Evidencia de restauración

Ejecutada el 20 de septiembre de 2026 con `./scripts/prueba-restauracion.sh`.
**No se tocó producción:** se clonó la instancia a `maintrack-db-rescate`, se
verificó ahí y se borró la copia al terminar.

| Qué se verificó | Resultado |
|---|---|
| Conteos de 18 tablas contra producción | Iguales (5 empresas, 24 usuarios, 45 órdenes, 180 movimientos, 671 registros de auditoría…) |
| Referencias | Ninguna orden, movimiento ni actividad apunta a un registro que no llegó |
| Kardex | La existencia por almacén sigue cuadrando con el total de cada refacción |
| Usuarios | Cada persona conserva correo, rol y si estaba activa; las 24 contraseñas viajaron |
| Empresas | Las 5 conservan plan y estado |
| Adjuntos | Los 9 conservan su ruta dentro de su empresa |
| Bitácora | Llega hasta el momento de la copia |

**Tiempo de recuperación medido: unos 25 minutos** — la clonación tardó unos
quince y la verificación ocho y medio. Repuntar el servicio a la copia sería
un cambio de variable más. La pérdida máxima de información es de **hasta 5
minutos** con recuperación a un punto en el tiempo, o de **un día** si solo se
usara el respaldo diario.

Lo que esta prueba **no** cubre: los archivos adjuntos no viven en la base
sino en el almacén de Google Cloud, que tiene su propio ciclo de vida. Lo que
se verificó es que las referencias sobrevivieron.

---

## Respaldo y recuperación

El procedimiento completo está en `Docs/bloque-3-seguridad.md`. Lo que agrega
este bloque:

| Concepto | Valor |
|---|---|
| Frecuencia | Respaldo automático diario a las 08:00 UTC; manual antes de cada migración |
| Retención | 7 automáticos; los manuales se limpian a los 30 días conservando al menos 3 |
| Punto en el tiempo | 7 días |
| Ubicación | Google Cloud, us-central1 |
| Responsable | Rafael Montemayor (único con acceso al proyecto) |
| Objetivo de recuperación (RTO) | ~25 minutos, **medido** |
| Pérdida máxima aceptable (RPO) | 5 minutos |
| Cómo se prueba | `./scripts/prueba-restauracion.sh`, que clona, verifica y borra |

**Riesgo conocido:** la instancia es **zonal** (`db-f1-micro`, 10 GB), sin
alta disponibilidad. Una zona caída es una caída total hasta restaurar.

---

## Monitoreo y alertas

### Lo que ya vigila el sistema

| Qué | Dónde se ve |
|---|---|
| Procesos programados: última corrida, fallas seguidas, «callado» | Empresas cliente › Procesos programados |
| Entregas de avisos fallidas y en cola, por empresa | Empresas cliente › Avisos e integraciones |
| Webhooks suspendidos y errores de API | La misma pantalla |
| Consumo y fallas de IA por empresa | Empresas cliente › IA |
| Fallas del programador por empresa | Campana de esa empresa |
| Cambios relevantes | Bitácora de auditoría de cada empresa |

### Lo que falta (pendiente, requiere decisión)

Ninguna alerta **sale** del sistema: hay que entrar a mirar. Para un piloto
real hacen falta, en Google Cloud:

| Alerta | Umbral sugerido | Canal |
|---|---|---|
| Servicio caído | Uptime check cada 5 min contra `/login` | Correo |
| Errores 5xx | Más de 5 en 5 minutos | Correo |
| Cron fallido | Job de Cloud Scheduler con resultado distinto de 200 | Correo |
| Respaldo fallido | Operación de respaldo con estado distinto de exitoso | Correo |
| Base sin espacio | Uso de disco por encima del 80 % | Correo |

Son cinco políticas y un canal de notificación. **No se crearon**: son cambios
en la infraestructura de producción y no estaban autorizados.

---

## Plan del piloto

La estructura está lista para llenarse con datos reales. **No se inventó
ninguno.**

| Concepto | Valor |
|---|---|
| Empresa piloto | *(por definir; distinta de la demostrativa)* |
| Responsable del cliente | *(por definir)* |
| Administrador de la cuenta | *(por definir)* |
| Supervisor / Técnicos / Compras / Solicitantes | *(por definir)* |
| Sitios y activos iniciales | *(por definir)* |
| Inventario y planes iniciales | *(por definir)* |
| Fecha de inicio y duración | *(por definir; 4 semanas + semana 0)* |
| Canal de soporte | Solicitud de soporte dentro de MainTrack |

### Ruta

| Semana | Qué se hace | Cómo se sabe que salió bien |
|---|---|---|
| 0 | Configuración, importación, capacitación por rol, validación de datos | Puesta en marcha al 100 %, sin pendientes de calidad |
| 1 | Solicitudes y correctivos | Toda falla entra por el sistema; ninguna orden se cierra sin causa |
| 2 | Preventivos y medidores | El programador genera a tiempo; cumplimiento medible |
| 3 | Inventario y compras | El kardex cuadra con el conteo físico; una compra completa de punta a punta |
| 4 | Indicadores, cierre y evaluación | La dirección toma una decisión con los indicadores del sistema |

### Criterios para detener el piloto

Pérdida o corrupción de información; acceso de una empresa a datos de otra;
duplicación de órdenes, compras o movimientos; el equipo del cliente deja de
usarlo y vuelve al papel.

---

## Checklist de salida

| Criterio de no salida | Estado |
|---|---|
| Pérdida o corrupción de información | Sin evidencia. Inventario, folios y cierre de OT protegidos con escritura condicional |
| Acceso entre empresas | **Cerrado.** 52 intentos automatizados de cruce, todos rechazados |
| Permisos incorrectos en operaciones críticas | **Corregido** (hallazgo 4). La matriz de roles se aplica en el servidor y se prueba con los 7 roles contra 17 acciones |
| Duplicación de órdenes, compras o movimientos | **Corregido** (hallazgos 2 y 3). Queda un residuo: no hay restricción en la base que impida dos OT abiertas del mismo plan y equipo; el candado es la defensa |
| Restauración no comprobada | **Comprobada** el 20 de septiembre de 2026 |
| Procesos críticos sin trazabilidad | Cubierto: bitácora inmutable, kardex, historial de avisos y ahora registro de corridas de procesos |
| Errores frecuentes en móvil | Sin evidencia de errores, pero **no se ha probado en dispositivos físicos** |
| Ausencia de responsable de soporte | Rafael Montemayor, por la sección Soporte dentro del producto |
| Ausencia de procedimiento de recuperación | Documentado y probado |

---

## Pendientes heredados

### Bloque 5

- **Deduplicación del resumen en una generación real:** pendiente.
- **Los 21 recordatorios contra 2 esperados:** *explicado*. El ensayo de
  reconciliación contra producción (20 de septiembre, sin escribir nada) da
  cero avisos por atender y cero por unificar en las cinco empresas; los
  conteos altos son el reparto por persona de avisos que siguen abiertos, no
  recordatorios repetidos. La causa está documentada en `bloque-5-avisos.md`:
  al encender el proceso, todo lo vencido se avisa de golpe y los
  escalamientos empiezan por su primer recordatorio pendiente.

### Bloque 6

- Pruebas con sesiones reales de cada rol: **hechas** por HTTP en
  `prueba-experiencia.ts`.
- Dispositivos móviles físicos: **pendiente manual**.
- Cámara y QR real: **pendiente manual** (la prueba usa una cámara simulada).

### Bloque 7

- Revisión jurídica profesional y documentos definitivos: **pendiente**.
- Sitio comercial, formulario de demostración, presentación, contratación,
  restauración de la demo y las cinco historias: **hechos** y verificados en
  `prueba-comercial.ts`.
- Novena cuenta de la demostrativa: **corregida** (desactivada).
- Precios con o sin IVA, tiempos de soporte, proveedor de correo: **pendientes
  de decisión**.

---

## Conclusión ejecutiva

**Preparación estimada para piloto: 75 %.**

**Bloqueantes encontrados: siete.** Seis corregidos y verificados con prueba
de regresión; el séptimo —enterarse de una falla— está resuelto a medias:
el sistema ya registra y muestra lo que pasa, pero nada sale a buscar a una
persona.

**Riesgos aceptables para un piloto acompañado:** que una pantalla se sienta
lenta con volumen alto (se puede medir y corregir durante el piloto), que los
avisos por correo no salgan (el piloto opera con la campana y los avisos al
celular, y se le dice al cliente), y que la base sea zonal (una caída de zona
se recupera en ~25 minutos, ya medidos).

**Pruebas pendientes:** volumen —lo más importante, porque sin ella todo el
diagnóstico de rendimiento son estimaciones—, dispositivos físicos, y cámara
con QR real.

**Recomendación: listo con condiciones.** Las condiciones, en orden:

1. **Crear las cinco alertas de Google Cloud** con un correo de destino. Sin
   esto, el piloto opera a ciegas fuera del horario de trabajo.
2. **Construir la empresa de volumen y medir** las ocho pantallas pesadas
   antes de que el cliente las cargue con sus datos.
3. **Probar en un iPhone y un Android reales**, incluyendo cámara y QR.
4. **Definir la empresa piloto y sus personas**, y llenar el plan de arriba.

Ninguna de las cuatro es trabajo de más de unos días. Hasta entonces, MainTrack
no está listo para producción abierta, pero sí para un piloto acompañado con
una empresa que sepa que lo es.
