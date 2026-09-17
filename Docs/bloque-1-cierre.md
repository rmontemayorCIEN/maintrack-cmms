# Bloque 1 · Integridad de datos e indicadores — Nota técnica de cierre

Fecha de la nota: 17 de septiembre de 2026.

## 1. Cambio de fórmulas de los indicadores

**Entrada en vigor.** Las reglas nuevas de indicadores, vencimientos, medidores y
predictivo entraron a producción con la revisión `maintrack-cmms-00165-p8t`, el
**16 de septiembre de 2026 a las 23:38 (America/Monterrey)**. Los ajustes de
cierre descritos en la sección 2 entran con el siguiente despliegue.

**Impacto visual en cifras históricas.** Ningún indicador se guarda: se calcula
al abrir la pantalla con los datos crudos. Por eso, desde la entrada en vigor,
**cualquier periodo que se consulte —también los pasados— muestra la cifra con
la regla nueva**. Una cifra anotada antes (en una junta, una captura de
pantalla, un reporte exportado) puede no coincidir con la que se ve hoy para el
mismo periodo. No se alteró ningún dato histórico para conservar las cifras
anteriores. Los diagnósticos de IA ya generados conservan el texto con las
cifras de su momento.

| Indicador | Regla anterior | Regla nueva | Razón | Impacto esperado |
|---|---|---|---|---|
| Periodo (todos) | "Ahora menos N días" al milisegundo, en UTC | Días completos en la zona de la empresa, hoy incluido, intervalo `[desde, hasta)` | Dos pantallas abiertas a distinta hora daban ventanas distintas; un evento de las 23:00 caía al día siguiente | Diferencias pequeñas en los bordes del periodo |
| Paro acumulado | Eventos de paro desde `desde`, **sin límite superior** | Eventos de paro con inicio dentro del periodo | Un periodo incluía todo lo posterior | Puede bajar |
| Paro no planeado | Igual, sin límite superior | Eventos no planeados dentro del periodo | Idem | Puede bajar |
| Paro planeado | No se mostraba aparte | Eventos planeados dentro del periodo, reportado aparte | El planeado se mezclaba con la pérdida | Nuevo |
| Disponibilidad | Restaba **todo** el paro (también el planeado) | `(h periodo × equipos − paro no planeado) ÷ (h periodo × equipos)` | El mantenimiento programado no es pérdida por falla | Sube si hay paro planeado |
| MTBF | `(calendario − todo el paro) ÷ max(1, correctivos cerrados)` | `(calendario − paro no planeado) ÷ fallas creadas en el periodo` (tipo falla en la orden o en una actividad, sin canceladas); sin fallas: «Sin fallas en el periodo» | Con cero fallas mostraba el periodo entero como dato; ignoraba fallas en actividades | Cambia; puede quedar sin cifra |
| MTTR | Horas de correctivos creados en el periodo con fecha de terminación, incluidas las de 0 h | Horas reales ÷ reparaciones de falla **terminadas** en el periodo **con horas**; las sin horas se informan aparte | Las reparaciones sin horas bajaban el promedio artificialmente | Normalmente sube |
| Cumplimiento preventivo | Preventivos creados en el periodo; sin fecha compromiso contaba "a tiempo"; canceladas en el denominador; comparación por hora exacta | Preventivas e inspecciones con **día compromiso** en el periodo: en fecha ÷ (en fecha + tarde + vencidas abiertas); canceladas fuera; abiertas aún no vencidas no se juzgan; por día en la zona de la empresa y con la fecha de finalización operativa | Premiaba lo que no tenía fecha y castigaba lo terminado el mismo día después de medianoche UTC | Cambia en ambos sentidos |
| Tiempo de respuesta | Promedio de todas las órdenes cerradas | Promedio (inicio − creación) de órdenes de falla iniciadas en el periodo | Mezclaba preventivos programados con la respuesta a fallas | Cambia |
| Trabajo planificado | No correctivas ÷ cerradas (sin apoyos) | No falla ÷ terminadas en el periodo (sin apoyos); falla según `lib/fallas` | Un correctivo dentro de una preventiva contaba como planificado | Puede bajar |
| Backlog / vencidas | Vencida = `dueDate < ahora` | Vencida = abierta con día compromiso pasado en la zona de la empresa | Una orden que vence hoy aparecía vencida desde la tarde anterior | Puede bajar |
| Costo | Órdenes **creadas** en el periodo, **incluidas canceladas** | Órdenes **terminadas** (finalización operativa) en el periodo, sin canceladas; lo cargado a abiertas se informa aparte | El costo caía en el mes de creación y las canceladas inflaban | Se mueve de mes; baja si había canceladas con costo |
| Ranking de activos por costo | Todo el historial, incluidas canceladas, paro del encabezado | Terminadas en el periodo; paro no planeado de los eventos | Idem | Cambia |
| Índice de calidad de captura | Reglas propias; "activos con plan" por encabezado viejo; causa raíz exigida a toda orden cerrada | Reglas únicas de `lib/calidad-datos.ts`; plan por asignación; causa raíz solo en reparaciones de falla (orden o actividad); nuevas reglas de datos imposibles | Una definición por pregunta | Puede subir o bajar |

## 2. Ajustes de cierre (este despliegue)

- **Lecturas imposibles**: un horómetro que suma más horas que las naturales sigue bloqueado sin excepción por justificación. El mensaje incluye lectura anterior, nueva, incremento pretendido, horas naturales, máximo permitido y las tres alternativas (corregir, sustitución, reinicio).
- **Reinicios y sustituciones**: se pueden corregir (valor, tipo o fecha) o anular con motivo obligatorio, sin borrado físico, conservando valor, tipo, usuario y fecha originales y quién/cuándo corrigió. La meta de los planes por uso se recorre por la diferencia (se guarda el valor anterior del medidor en el evento). Si anular o corregir rompería la continuidad de lecturas posteriores, se niega y dice cuáles.
- **Sin lectura vigente**: si todas las lecturas quedan anuladas y no hay valor inicial formal, el medidor muestra «Sin lectura vigente», no se proyectan planes y el programador no genera por uso. Los medidores nuevos guardan su valor de alta como valor inicial formal.
- **Recálculo**: `planearRecalculo` / `aplicarRecalculo` en transacción, idempotente (fechas contadas desde la medianoche de hoy en la zona de la empresa), y el script `scripts/recalcular-medidores.ts` (ensayo por omisión, `--aplicar` explícito).
- **Rutinas diarias**: confirmación explícita (quién y cuándo) al guardar; la confirmación se retira sola con rastro si la actividad deja de ser diaria, o manualmente con motivo; las no confirmadas son advertencia de calidad.
- **Alertas predictivas**: completar o cerrar una OT no toca la alerta; «Resolver» solo procede cuando una lectura mostró la normalización y el punto sigue normal; se guardan la lectura de evidencia, quién cerró, cuándo y la nota. «Descartar» pide motivo.
- **IA y zona horaria**: la ficha de activo de la IA y la de la pantalla leen los planes por asignación (no por el encabezado). Fechas del lado del servidor con la zona de la empresa en Ficha del activo, Diagnóstico IA, Dónde para la planta (IA) y Pregunte a sus datos; el expediente de recurrencia usa el periodo central, excluye canceladas y toma el paro de los eventos.

## 3. Migraciones

| Migración | Estado | Contenido | Reversión |
|---|---|---|---|
| `20260916231648_integridad_medidores_y_predictivo` | Aplicada en producción (16-sep 23:38) | Columnas de tipo/máximo de medidor, rastro de lecturas, evaluación predictiva en alertas; deriva `Meter.tipo` de la unidad | SQL en el encabezado del archivo |
| `20260916235417_medidores_vigencia_y_confirmaciones` | **Pendiente** | `Meter.valorInicial/valorInicialEl/lecturaVigente`, `MeterReading.tipoOriginal/valorAnterior`, `PlanTask.diariaConfirmadaPorId/El`, `PredictiveAlert.normalizacion*/resuelta*/resolucion` | SQL en el encabezado del archivo |

Ambas agregan solo columnas nulas o con valor por omisión. La única escritura de datos es de configuración: la primera asigna `Meter.tipo` según la unidad. Ninguna modifica lecturas, órdenes, alertas ni cifras históricas.

## 4. Ensayo en producción (17-sep, 00:15 Monterrey)

- Respaldo bajo demanda previo: `1789625624588` · SUCCESSFUL · 06:13–06:15 UTC.
- `scripts/ensayo-migracion.ts`: aplicó la migración pendiente (4 sentencias, 483 ms), corrió el ensayo de recálculo sobre el esquema migrado y **revirtió todo**. Transacción abierta 3.6 s. Base intacta verificada después. Cloud SQL quedó sin redes autorizadas y el sitio respondió 200.

Resultado del ensayo de recálculo (solo Acero Industrial del Norte (Demo) tiene medidores):

| Medidor | Valor | Promedio/día | Plan · meta · fecha estimada | Registros |
|---|---|---|---|---|
| GRU-501 ciclos | 142,500 = | 180 = | — | 2 |
| TOR-101 husillo | 9,840 = | 14 = | — | 2 |
| CNC-201 husillo | 11,250 = | 15 = | — | 2 |
| **CMP-301 horómetro** | 20,500 = | **117.24 → 24** | Servicio 2,000 h · 22,500 = · **27-sep → 10-dic** · EN_TIEMPO | 3 |
| CMP-302 horómetro | 4,230 = | 3 = | — | 2 |
| GEN-402 horómetro | 1,180 = | 1.2 = | — | 2 |
| MON-502 horómetro | 6,890 = | 7 = | Servicio 500 h · 7,057 = · **(sin fecha) → 11-oct** · EN_TIEMPO | 3 |

- 16 registros se modificarían: 7 incrementos (la primera lectura de cada medidor traía incremento de la carga de demostración y no tiene contra qué medirse), 7 medidores (en 6 la diferencia no se ve en el valor ni en el promedio redondeado: es la fecha de última lectura guardada en el medidor, que no coincide con su lectura más reciente, o una diferencia de decimales; en CMP-301 es el promedio) y 2 fechas estimadas de planes por uso.
- 0 avisos de plan cambian de estado.
- **1 lectura inválida sin corregir**: CMP-301, 2-sep, 20,500 h (+2,080 h en 96 h de reloj). El promedio queda topado en 24 h/día (máximo físico). En cuanto se corrija o anule desde Medidores, el promedio y la fecha del plan se recalculan solos.
- Las alertas predictivas no dependen de medidores; el recálculo no las toca.

## 5. Pruebas

Suite completa: 44 pruebas, **38 pasan**; las 6 que fallan son las `*-real`. `prueba-integridad-datos` pasa sus 141 verificaciones tanto con la zona local como con `TZ=UTC` (como corre producción). Compilación de producción y validación de tipos: correctas.

**Deuda técnica registrada**: no hay ESLint configurado (`next lint` pide configurarlo de forma interactiva). No se configuró en este bloque.

### Línea base de las pruebas `*-real`

«Antes» = commit `0117811` (anterior al Bloque 1) corrido sobre una copia de la misma base local.

| Prueba | Antes del Bloque 1 | Actual | Causa | Depende de | Acción recomendada |
|---|---|---|---|---|---|
| `agenda-real` | Falla | Falla | Recorre **todas** las empresas de la base; en local hay ~1,400 empresas huérfanas de otras pruebas cuyo plan no incluye la función («Su plan no incluye revisar la semana»); además requiere llave de IA | Plan de la cuenta + datos locales contaminados + llave | Acotar a una cuenta explícita (como `procedimiento-real`) y correr con `con-produccion.sh` |
| `arranque-real` | Falla | Falla | Igual («Su plan no incluye por dónde empezar los preventivos») | Plan + datos locales + llave | Igual |
| `equipo-real` | Falla | Falla | Igual («Su plan no incluye revisar al equipo») | Plan + datos locales + llave | Igual |
| `equivalencias-real` | Falla | Falla | Igual («Su plan no incluye equivalencias sugeridas») | Plan + datos locales + llave | Igual |
| `paros-real` | Falla | Falla | Busca la cuenta por el nombre de producción «Acero Industrial del Norte (Demo)»; en local se llama «Acero Industrial del Norte» | Datos locales | Buscar por slug o variable de entorno; correr contra producción |
| `procedimiento-real` | Falla con la base en el estado actual (pasa o falla según qué prueba corrió antes) | Falla de forma **determinista** («IA no configurada») | Ver investigación abajo | Llave de IA (después del arreglo) | Correr con `con-produccion.sh`; limpiar empresas huérfanas |

### Investigación de `procedimiento-real`

No era intermitencia: **era contaminación entre pruebas**.

- La prueba tomaba las 3 órdenes más recientes de **toda la base**, sin acotar por empresa.
- Varias pruebas (`ciclo-completo`, `asignaciones`, `reprogramar`, `backlog`, `equivalencias`, `fusion`, `orden-por-actividad`, `fechas-de-actividad`, entre otras) crean empresas y **no las borran**: hay ~1,400 empresas huérfanas en la base local («Ajena» 519, «Prueba backlog» 137, «Ciclo» 130…).
- Sola, después de pruebas cuyas últimas órdenes no tenían activo, la IA se negaba con motivo («la orden no tiene activo») y la prueba lo contaba como correcto → pasaba.
- Dentro de la suite, las últimas órdenes eran las de «Ciclo», con activo → llegaba a la llamada de IA sin llave → fallaba.
- Se reprodujo: tras `prueba-ciclo-completo`, la prueba toma `OT-000003 (Ciclo)` y falla.

**Arreglo aplicado**: la prueba usa una cuenta explícita (`PRUEBA_ORG_SLUG`, por omisión `acero-industrial`) y solo órdenes con activo. Verificado: toma las mismas órdenes antes y después de correr una prueba que deja datos; sin llave falla siempre por la misma causa, con llave se ejercita el ciclo real.

**Deuda técnica registrada**: las pruebas que dejan empresas huérfanas deben limpiar en `finally` (como ya lo hace `prueba-integridad-datos`), y conviene un script de limpieza de la base local.

## 6. Plan de despliegue

Ventana: **no requiere corte**. Las columnas nuevas son nulas o con valor por omisión constante (en PostgreSQL 11+ es un cambio de metadatos). La revisión actual (`00165`) sigue funcionando con las columnas nuevas porque no las lee. En el ensayo la migración tardó 483 ms; toma candados exclusivos muy breves sobre `Meter`, `MeterReading`, `PlanTask` y `PredictiveAlert`. Se recomienda un horario de poco uso.

Orden obligatorio: **migrar antes de publicar** (el código nuevo con la base sin migrar falla con P2022). `npm run actualizar` ya lo hace en ese orden.

1. Guardar los cambios en un commit.
2. Respaldo inmediatamente anterior y verificación:
   ```bash
   CLOUDSDK_CORE_PROJECT=maintrack-cmms-4821 gcloud sql backups create --instance=maintrack-db --description="Antes de desplegar cierre Bloque 1"
   CLOUDSDK_CORE_PROJECT=maintrack-cmms-4821 gcloud sql backups list --instance=maintrack-db --limit=1
   ```
   Anotar el ID y confirmar `SUCCESSFUL`.
3. Repetir el ensayo (debe decir «Base intacta tras revertir: SÍ»):
   ```bash
   ./scripts/con-produccion.sh scripts/ensayo-migracion.ts
   ```
4. Guardar el estado previo de medidores para poder comparar:
   ```bash
   ./scripts/con-produccion.sh scripts/recalcular-medidores.ts --json > recalculo-antes.json
   ```
5. Publicar:
   ```bash
   npm run actualizar
   ```
6. Verificar: HTTP 200, Cloud SQL cerrada, secretos completos (lo reporta el script); en la aplicación, Panel, Medidores (CMP-301), Alertas y el diálogo de un plan.
7. Recálculo: **solo el ensayo** y presentar el resultado. `--aplicar` únicamente con aprobación explícita.
8. Corregir o anular la lectura de 20,500 h de CMP-301 desde Medidores (decisión operativa de la empresa).

## 7. Plan de reversión

De menor a mayor impacto:

1. **Regresar la aplicación** a la revisión anterior (funciona con las columnas nuevas):
   ```bash
   CLOUDSDK_CORE_PROJECT=maintrack-cmms-4821 gcloud run services update-traffic maintrack-cmms --region us-central1 --to-revisions=maintrack-cmms-00165-p8t=100
   ```
2. **Dejar las columnas nuevas**: no estorban a la revisión anterior. Es la opción recomendada.
3. **Quitar las columnas** (solo si se decide, y después del paso 1): ejecutar el SQL de reversión del encabezado de `20260916235417_medidores_vigencia_y_confirmaciones/migration.sql` y borrar su renglón en `_prisma_migrations`. Se pierde lo capturado en esas columnas (confirmaciones de rutinas diarias, evidencia de normalización, valores iniciales, rastro de correcciones de reinicios).
4. **Recálculo aplicado**: los valores derivados (promedio, incrementos, fechas estimadas) se pueden reconstruir con `recalcular-medidores.ts` en cualquier momento; el estado previo queda en `recalculo-antes.json`.
5. **Último recurso — restaurar el respaldo** del paso 2 (`gcloud sql backups restore <ID> --restore-instance=maintrack-db`): sobrescribe TODO lo capturado después del respaldo. Requiere decisión explícita.
