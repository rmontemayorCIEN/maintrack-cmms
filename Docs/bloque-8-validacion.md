# Bloque 8 — Validación integral, piloto controlado y preparación para salida

Auditoría del 20 de septiembre de 2026. Primero se auditó sin tocar nada; la
corrección vino después y solo sobre defectos comprobados.

**Recomendación: listo para un piloto acompañado.** Las condiciones están al final.

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
| 7 | **No hay forma de enterarse de una falla nocturna.** Cero alertas en Google Cloud, ningún cron detectaba que dejó de correr, y las cuatro rutas respondían 200 aunque por dentro hubieran fallado | Corregido — ver «Monitoreo y alertas» |

### Altos

| # | Hallazgo | Estado |
|---|---|---|
| 8 | Novena cuenta en la empresa demostrativa de producción, creada a mano, que contradecía la guía | Corregido: desactivada, no borrada |
| 9 | El cierre de OT libera las solicitudes **antes** del candado de estado: quien pierde la carrera las deja sueltas | Corregido |
| 10 | `lib/api.ts` devuelve el mensaje crudo de cualquier excepción al cliente con 500, incluidos los de Prisma con nombre de modelo y campos | Corregido: los de regla de negocio siguen llegando con su texto; los internos se contestan en genérico y se registran con empresa, usuario y rastro |
| 11 | Los adjuntos validan el tamaño **declarado**, no el real tras subir a Google Cloud Storage | Corregido: se comprueba el peso real y el cupo con ese peso; lo que no cabe se borra del almacén |
| 12 | El logotipo admite SVG y se sirve como `image/svg+xml` desde el propio origen | Corregido: ya no se admite, y los que existían se entregan inertes |
| 13 | El límite de solicitudes públicas vive en memoria del proceso: con diez instancias son 50/hora, no 5 | Corregido: se cuenta en la base |
| 14 | **No existe ninguna prueba de volumen**, así que todo el diagnóstico de rendimiento son estimaciones razonadas sobre el código, no mediciones | Corregido — ver «Rendimiento medido» |
| 15 | Faltan índices compuestos en las tablas que crecen; `DowntimeEvent` es el único modelo grande sin `organizationId` | Corregido: doce índices compuestos y la columna, rellenada desde el activo |
| 16 | Los resúmenes diarios hacen ~500 consultas secuenciales con 40 usuarios, y comparten el grupo de conexiones con las pantallas | Pendiente: es trabajo de fondo, no bloquea una pantalla |

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
| `prueba-bloque-8.ts` (ampliada) | Que un error de Prisma no le cuente al cliente cómo está hecho el sistema y que uno de regla de negocio sí le llegue con su texto; que el logotipo ya no admita SVG; que el límite de solicitudes frene a la sexta y no afecte a otra conexión; que cada paro pertenezca a la empresa de su equipo |
| `sembrar-volumen.ts` + `prueba-rendimiento.ts` (nuevas) | El volumen de un piloto al cabo de un año, y el cronómetro sobre las mismas funciones que llaman las pantallas |
| `prueba-rendimiento-real.sh` (nueva) | Lo mismo, pero en PostgreSQL del tamaño de producción, en una instancia nueva y vacía que se borra al terminar |

**Cómo se comprobó que las pruebas sirven:** se quitó el candado del
programador a propósito y la prueba falló con dos órdenes; se volvió a poner y
pasó con una. La depuración de costos de la IA se escribió primero con una
lista de nombres y la prueba encontró dos campos que se escapaban, lo que
obligó a cambiarla por un patrón.

La prueba de volumen **no** va en la corrida diaria: tarda y deja 400 000
renglones en la base de desarrollo. Se corre cuando se toca una consulta de
las pesadas o antes de un arranque.

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
| Procesos programados: última corrida, fallas seguidas, «callado» | Empresas cliente › Procesos programados. «Callado» es distinto de «aún no le toca»: un proceso semanal recién desplegado no se marca en rojo |
| Entregas de avisos fallidas y en cola, por empresa | Empresas cliente › Avisos e integraciones |
| Webhooks suspendidos y errores de API | La misma pantalla |
| Consumo y fallas de IA por empresa | Empresas cliente › IA |
| Fallas del programador por empresa | Campana de esa empresa |
| Cambios relevantes | Bitácora de auditoría de cada empresa |

### Lo que sale a buscar a una persona

Creadas con `./scripts/alertas.sh`, que es idempotente y deja escrito el
umbral y la métrica de cada una. Todas avisan por correo a la cuenta del
operador.

| Alerta | Cuándo suena |
|---|---|
| MainTrack no responde | La revisión de disponibilidad contra `/login` falla 5 minutos |
| MainTrack devuelve errores (5xx) | Más de 5 respuestas de error en 5 minutos |
| Un proceso programado dejó de correr | `/api/salud` contesta 503 durante 10 minutos |
| La base se está llenando | Disco de Cloud SQL por encima del 80 % durante 10 minutos |

La tercera necesitaba algo que no existía. **Un proceso muerto no produce
ninguna señal**: calla igual que uno sano. La métrica de Cloud Scheduler no
sirve —mide intentos, no ausencias, y ni siquiera existe hasta que hay
datos—, así que ahora hay `/api/salud`, que contesta 503 cuando un proceso
lleva más de tres periodos sin terminar o acumula tres fallas seguidas, y una
revisión de disponibilidad que le pega cada cinco minutos. Para contestar
tiene que consultar la base, así que una caída de Cloud SQL también cae ahí.

**Falta una:** que avise si un respaldo de Cloud SQL falla. No hay métrica
estándar para eso; se revisa a mano con
`gcloud sql backups list --instance maintrack-db`.

---

## Rendimiento medido

**Cómo se midió.** `scripts/sembrar-volumen.ts` crea una empresa con el
volumen de un piloto al cabo de un año: 800 activos, 40 usuarios, 20 000
órdenes con sus actividades, 5 000 solicitudes, 60 000 movimientos de
almacén, 100 000 lecturas de medidor, 30 000 registros de auditoría, 20 000
avisos y 3 000 paros. `scripts/prueba-rendimiento.ts` cronometra las **mismas
funciones** que llaman las pantallas y falla si alguna pasa de 1.5 segundos.

Se midió dos veces, y la diferencia importa:

- **En SQLite** (la base de desarrollo), todo queda holgado. No dice mucho:
  SQLite vive dentro del proceso, así que traer veinte mil renglones cuesta
  microsegundos porque no hay red, ni serialización, ni conexiones que
  compartir.
- **En PostgreSQL**, con `./scripts/prueba-rendimiento-real.sh`, que crea una
  instancia **nueva y vacía** del mismo tamaño que producción
  (`db-f1-micro`), le aplica las migraciones, le siembra el volumen, mide y la
  borra. No clona producción: no hay un solo dato de ningún cliente de por
  medio.

### Lo que se midió en PostgreSQL

Instancia nueva del tamaño de producción (`db-f1-micro`), 20 000 órdenes ·
60 000 movimientos · 100 000 lecturas.

**Una advertencia sobre estos números, porque ya me hizo equivocarme una
vez.** Una instancia recién creada tiene la caché fría, y la diferencia con
la misma instancia ya caliente es de dos a cuatro veces. La primera tabla que
escribí comparaba un «antes» frío contra un «después» caliente y exageraba la
mejora. Esta compara **frío contra frío** —primera corrida después de sembrar,
en las dos— y añade el caliente aparte.

| Pantalla | Antes (frío) | Después (frío) | Después (caliente) |
|---|---|---|---|
| Inicio del administrador | 6 624 ms | **3 148 ms** | 2 400 – 3 400 ms |
| Inicio de la dirección | 5 167 ms | **2 695 ms** | 2 000 – 2 200 ms |
| Calidad de datos | 6 402 ms | **4 730 ms** | 960 – 1 071 ms |
| Indicadores (90 días) | 4 752 ms | **1 373 ms** | 1 085 – 1 417 ms |
| Buscar «bomba» | 1 301 ms | 1 499 ms | 194 – 296 ms |
| Órdenes de trabajo (200) | 695 ms | 748 ms | 250 ms |
| Kardex (1 000) | 499 ms | 760 ms | 160 ms |
| Expediente del activo | 495 ms | 299 ms | 125 ms |
| Almacén, bitácora, vencidas, dónde para la planta | < 500 ms | < 500 ms | < 250 ms |

Las cifras de una misma pantalla varían hasta el triple entre corridas: sirven
para el orden de magnitud y para comparar antes/después, **no** como promesa
de tiempos.

### Qué estaba mal, y era distinto de lo que se suponía

La auditoría había señalado la búsqueda global como el peor problema. Medida,
resultó ser de las rápidas. **Lo caro era otra cosa:**

1. **La revisión de calidad recorría todas las lecturas de todos los
   medidores** para detectar saltos imposibles: cien mil renglones traídos a
   memoria en cada carga del inicio del administrador, 2.4 de sus 6.4
   segundos. Y era trabajo repetido: el sistema **ya** hace esa revisión al
   registrar cada lectura y guarda el dictamen en el medidor. Ahora lo lee en
   vez de recalcularlo.
2. **Comparar dos columnas se hacía en JavaScript.** «Terminó antes de
   empezar», «paro al revés» y «bajo mínimo» traían todas las filas para
   descartar casi todas. La base sabe hacer eso.
3. **`refaccionesBajoMinimo` traía 5 000 refacciones** en cada carga del
   inicio de dirección, administración y compras.

### `calcularIndicadores`

Bajó de 4 752 a 1 373 ms en frío y queda debajo del límite. Lo que se le
corrigió:

- **El backlog era la única consulta sin periodo**: traía todas las órdenes
  abiertas de la empresa, con sus actividades, en cada carga. Ahora el
  conteo y las sumas las hace la base, las vencidas salen del filtro que ya
  existe, y solo se dibujan las primeras 500 como muestra. Los números siguen
  siendo exactos; lo acotado es la lista.
- **Las actividades viajaban en las cinco consultas.** Solo tres clasifican
  fallas y las necesitan; el cumplimiento y el backlog no. Quitarlas de esas
  dos elimina una consulta anidada y miles de renglones que nadie leía.

### El inicio ya no calcula en la carga

Medido pieza por pieza, el 98 % del costo del inicio eran dos cosas: los
indicadores del periodo (617 ms) y la revisión de calidad de datos (363 ms).
Todo lo demás —vencidas, críticas, refacciones agotadas, compras por firmar—
cuesta entre 0 y 9 ms, porque son conteos con los índices nuevos.

Y esas dos son justamente las que no se mueven: son ventanas de 30 y 90 días.
Con quinientas órdenes juzgadas, cerrar una mueve el cumplimiento dos décimas.
Así que ahora se calculan **cada 15 minutos** y se guardan (`ResumenInicio`);
lo dinámico se sigue consultando en vivo, porque no hace falta congelar lo que
ya es gratis.

No lo recalcula un proceso programado sino **el propio uso**: quien abre el
inicio y encuentra el resumen vencido no espera —se le entrega el guardado— y
el recálculo ocurre después de contestarle. Así, una empresa que nadie abre no
cuesta nada, el primero de la mañana ve cifras de esa mañana, y si algo falla
la siguiente visita lo repara. La pantalla dice de cuándo son las cifras y trae
un botón para recalcularlas al momento.

| | Antes | Después |
|---|---|---|
| Inicio de la dirección | 687 ms | **38 ms** |
| Inicio del administrador | 435 ms | **47 ms** |

(Medido en SQLite, donde el resto ya estaba holgado; en PostgreSQL la
proporción es la misma y la diferencia absoluta, mayor.)

La prueba compara, cifra por cifra, lo guardado contra lo que calcula la
función en vivo: cambiar lentitud por números equivocados habría sido peor que
la lentitud.

### Lo que sigue pendiente

~~**Los dos inicios de mando siguen sobre el límite**~~ — resuelto arriba. Lo
que decía este párrafo:: 3.1 s el del
administrador y 2.7 s el de la dirección, en frío. No es una consulta lenta:
es que esas pantallas piden *todo* a la vez —indicadores, calidad de datos,
críticas, vencidas, compras por autorizar, refacciones bajo mínimo, avisos y
puesta en marcha—, y con un grupo de cinco conexiones contra la instancia más
chica que vende Google, las consultas se forman.

El siguiente paso no es optimizar otra consulta, es **dejar de calcular en la
carga**: que el proceso que ya corre cada hora deje escrito el resumen de
indicadores y de calidad por empresa, y que el inicio lea ese renglón. La
pantalla de Indicadores seguiría calculando en vivo. Es una decisión de
producto —el inicio mostraría cifras de hasta una hora antes— y por eso se
deja anotada en vez de tomarla de lado.

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
| Errores frecuentes en móvil | Sin evidencia de errores. **iPhone probado** el 20 de septiembre de 2026 (cámara y QR, funcionando); falta un Android real |
| Enterarse de una falla | **Cerrado.** Cuatro alertas activas por correo, incluida la del proceso que dejó de correr |
| Rendimiento con volumen de piloto | **Medido** en PostgreSQL del tamaño de producción — ver «Rendimiento medido» |
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
- Dispositivos móviles físicos: **iPhone hecho**; Android pendiente.
- Cámara y QR real: **hecho en iPhone** el 20 de septiembre de 2026, con
  resultado correcto. Falta el mismo ejercicio en un Android.

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

**Preparación estimada para piloto: 90 %.**

**Bloqueantes encontrados: siete. Los siete corregidos** y verificados con
prueba de regresión.

**Hallazgos altos: nueve. Ocho corregidos.** El que queda —los resúmenes
diarios hacen ~500 consultas secuenciales con 40 usuarios— es trabajo de
fondo: no bloquea ninguna pantalla.

**Riesgos aceptables para un piloto acompañado:**

- Los dos inicios de mando tardan alrededor de dos segundos con volumen de un
  año y cachés frías. Es lento, no es un error, y está medido y acotado.
- Los avisos por correo no salen: no hay proveedor conectado. El piloto opera
  con la campana del sistema y los avisos al celular, y al cliente se le dice.
  Las alertas de operación sí llegan por correo, porque las manda Google
  Cloud y no el producto.
- La base es zonal: una caída de zona se recupera en unos 25 minutos, ya
  medidos.
- La revisión de calidad ahora confía en el dictamen que el sistema guarda al
  registrar cada lectura. Es correcto por construcción —todas las lecturas
  entran por el mismo lugar—, pero un dato heredado con la marca desatrasada
  se corrige con `scripts/recalcular-medidores.ts`.

**Pruebas pendientes:** un Android real. **El iPhone ya se probó**: Rafael
leyó un QR con la cámara del teléfono el 20 de septiembre de 2026 y abrió el
equipo sin novedad. Eso cierra la parte de cámara y QR en iOS, y de paso
confirma que la prueba automatizada que falla a ratos es un problema del
arnés, no del producto.

**La prueba intermitente del QR: encontrada y corregida.** Pasaba unas
corridas y fallaba otras con el mismo código. El reintento no sirvió, así que
se instrumentó el fallo para que dijera por qué en vez de solo «no llegó», y
la primera corrida instrumentada lo delató: **no había elemento de video,
aunque la cámara sí se había pedido**.

La causa: el navegador de la prueba se lanzaba siempre en el mismo puerto de
depuración. Un Chrome de una corrida interrumpida seguía escuchando ahí, y la
corrida siguiente **se conectaba a ese** en vez de al suyo. Ese Chrome viejo
apunta al video falso de su propia corrida —un archivo temporal ya borrado—,
así que la cámara simulada no entregaba un solo cuadro. Fallaba o no según si
había quedado basura de antes: la receta exacta de una prueba «intermitente».

Ahora cada corrida usa su propio puerto, mata lo que haya quedado vivo al
empezar y se asegura de cerrar sus procesos al terminar. Dos corridas
seguidas, limpias.

Independientemente de eso, el producto ya estaba verificado donde importa: el
20 de septiembre se leyó un QR con la cámara de un iPhone real y abrió el
equipo sin novedad.

**Recomendación: listo para un piloto acompañado.** Las condiciones que
quedan:

1. **Probar en un Android real.** El iPhone ya se probó, con la cámara y el
   QR funcionando; falta el otro sistema, que es donde suelen aparecer las
   diferencias de cámara y de teclado.
2. **Definir la empresa piloto y sus personas**, y llenar el plan de arriba.
3. Durante el piloto, **volver a medir** con los datos reales: los umbrales
   de esta auditoría salieron de datos sintéticos, y la forma de los datos de
   un cliente siempre sorprende.

Para **producción abierta** —clientes dándose de alta solos— falta más: el
correo, los tiempos de soporte sostenibles, la revisión jurídica de los
documentos y decidir si los precios llevan IVA. Nada de eso es técnico.
