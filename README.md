# MainTrack CMMS

Plataforma SaaS multiempresa para la **programación y control de mantenimiento preventivo,
correctivo y predictivo**. Construida con Next.js 15 (App Router), TypeScript, Prisma y Tailwind CSS.

---

## Inicio rápido

```bash
npm install
npm run db:reset     # crea el esquema y carga la planta de demostración
npm run dev          # http://localhost:3000
```

**Cuentas de demostración** (contraseña `demo1234`):

| Correo | Rol |
|---|---|
| `director@aceroindustrial.mx` | Propietario / Dirección |
| `supervisor@aceroindustrial.mx` | Supervisor de mantenimiento |
| `tecnico@aceroindustrial.mx` | Técnico |
| `confiabilidad@aceroindustrial.mx` | Administrador |
| `produccion@aceroindustrial.mx` | Solicitante |

Los datos de demostración incluyen 14 activos, 10 planes, 8 puntos de monitoreo predictivo
con 90 días de lecturas, inventario y ~90 órdenes de trabajo históricas, para que los
indicadores tengan valores realistas desde el primer minuto.

---

## Los tres mantenimientos

### Preventivo — planes por calendario y por medidor
Un **plan** define frecuencia, lista de verificación, refacciones, horas estimadas,
anticipación y responsable. Dos formas de disparo:

- **Calendario**: cada N días. El siguiente vencimiento se recalcula al cerrar la orden.
- **Medidor**: cada N horas, kilómetros o ciclos. El sistema mantiene el consumo diario
  promedio (media móvil exponencial) de cada medidor y con él **proyecta la fecha** en que
  se alcanzará el intervalo, respetando la anticipación configurada.

El **programador** (`lib/scheduler.ts`) recorre los planes activos y genera la orden cuando
la ventana de anticipación se cumple. Nunca duplica: si ya existe una orden abierta del
mismo plan, la omite y explica por qué. Se ejecuta manualmente desde el calendario o de
forma automática vía `GET /api/cron/scheduler`.

### Correctivo — de la falla al cierre técnico
Producción levanta una **solicitud de servicio**; el supervisor la aprueba y se convierte
en orden correctiva. El flujo de estados es explícito y validado en el servidor:

```
DRAFT → OPEN → ASSIGNED → IN_PROGRESS → COMPLETED → CLOSED
              ↘ ON_HOLD ↗          ↘ CANCELLED
```

Al completar se exige la lista de verificación obligatoria y se captura **código de falla,
causa raíz, solución y tiempo de paro** — la materia prima de los indicadores de
confiabilidad. El paro se registra como evento del activo y alimenta MTBF y disponibilidad.

### Predictivo — condición, tendencia y vida remanente
Cada activo puede tener **puntos de monitoreo** (vibración, temperatura, corriente, presión,
análisis de aceite, ultrasonido). Al ingresar una lectura, `lib/predictive.ts`:

1. La clasifica contra los umbrales de advertencia y crítico.
2. Ajusta una **regresión lineal** sobre las últimas 40 lecturas y calcula la pendiente
   (unidades/día) y el **R²** como medida de confianza.
3. Proyecta cuándo se alcanzará el umbral crítico → **vida útil remanente** y fecha
   estimada de falla.
4. Abre una **alerta**; si la lectura es crítica —o si una alerta existente escala a
   crítica— genera automáticamente una **orden predictiva** con fecha compromiso anclada a
   la falla proyectada, y notifica a los supervisores.

También se emite alerta preventiva cuando la tendencia indica que el umbral se alcanzará en
menos de 30 días con R² ≥ 0.6, aunque la lectura actual siga en rango.

---

## Módulos

| Módulo | Contenido |
|---|---|
| **Panel de control** | Disponibilidad, cumplimiento PM, MTTR, MTBF, backlog, vencidas, costo; tendencia mensual, mezcla de mantenimiento, Pareto de activos, alertas y refacciones bajo mínimo |
| **Órdenes de trabajo** | Alta, filtros, lista de verificación con mediciones y rangos, mano de obra costeada, consumo de refacciones, bitácora, cierre técnico, formato imprimible |
| **Tablero** | Kanban con arrastre; solo permite transiciones válidas |
| **Calendario** | Órdenes programadas más la **proyección** de planes aún no generados |
| **Solicitudes** | Intake de fallas, aprobación/rechazo y conversión a orden |
| **Planes preventivos** | Plantillas de rutina, tareas con rango de aceptación, activación/baja, ejecución del programador |
| **Predictivo / Alertas** | Sensores, gráficas con umbrales, tendencia, vida remanente, gestión de alertas |
| **Activos** | Jerarquía padre-hijo, criticidad A/B/C, estado, garantía, salud del equipo, costo acumulado contra valor de reposición, historial completo |
| **Medidores** | Horómetros, odómetros y contadores; consumo diario y faltante para el próximo servicio |
| **Almacén** | Existencias, mínimos/máximos, costo promedio ponderado, entradas/salidas/ajustes y consumo automático desde las órdenes |
| **Reportes** | MTTR, MTBF, disponibilidad, cumplimiento PM, tiempo de respuesta, precisión de estimación, trabajo planificado, Pareto de costos, antigüedad del backlog, productividad por técnico y análisis de modos de falla |
| **Configuración** | Suscripción y límites del plan, usuarios y roles, sitios y ubicaciones, catálogos maestros, bitácora de auditoría y documentación de la API |

---

## Indicadores

| Indicador | Cálculo |
|---|---|
| MTTR | horas de reparación correctiva ÷ número de reparaciones |
| MTBF | (horas calendario × activos − horas de paro) ÷ número de fallas |
| Disponibilidad | (tiempo calendario − paro) ÷ tiempo calendario |
| Cumplimiento PM | preventivos cerrados en fecha ÷ preventivos programados |
| Trabajo planificado | órdenes no correctivas ÷ órdenes cerradas (meta 80%) |
| Precisión de estimación | promedio de min(est, real) ÷ max(est, real) |

---

## Multiempresa y seguridad

- Cada organización es un **tenant aislado**: todos los modelos llevan `organizationId` y
  toda consulta se filtra por el tenant de la sesión.
- Sesión JWT firmada (HS256) en cookie `httpOnly`, `sameSite=lax`, `secure` en producción.
- Contraseñas con bcrypt (10 rondas).
- **RBAC** en `lib/rbac.ts` con seis roles: propietario, administrador, supervisor, técnico,
  solicitante y consulta. Los permisos se aplican en el servidor, en cada ruta de API.
- Folios consecutivos por organización mediante incremento atómico.
- **Bitácora de auditoría** de altas, cambios de estado, conversiones y alertas.
- Los límites del plan (usuarios, activos) se validan al crear registros.

---

## API REST

Todas las rutas usan la cookie de sesión y quedan restringidas al tenant del usuario.

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/register` | Alta de organización + propietario |
| `POST` | `/api/auth/login` · `/api/auth/logout` | Sesión |
| `GET`/`POST` | `/api/work-orders` | Consulta con filtros / alta |
| `GET`/`PATCH`/`DELETE` | `/api/work-orders/{id}` | Detalle, edición, baja |
| `POST` | `/api/work-orders/{id}/status` | Transición de estado con cierre técnico |
| `POST`/`PATCH` | `/api/work-orders/{id}/tasks` | Alta y captura de tareas |
| `POST` | `/api/work-orders/{id}/labor` · `/parts` · `/comments` | Mano de obra, refacciones, bitácora |
| `GET`/`POST` | `/api/assets`, `/api/plans`, `/api/parts`, `/api/sensors`, `/api/meters`, `/api/requests`, `/api/users` | Catálogos |
| `POST` | `/api/readings` | Lectura de medidor |
| `POST` | `/api/sensors/readings` | Lectura de condición, individual o en lote (hasta 500) |
| `POST` | `/api/alerts/{id}` | Reconocer, resolver, descartar o generar OT |
| `POST` | `/api/scheduler` | Ejecución manual del programador |
| `GET` | `/api/cron/scheduler` | Ejecución programada (todas las organizaciones) |
| `GET` | `/api/export/{work-orders,assets,inventory}` | Exportación CSV |

Ejemplo de ingesta desde una pasarela IoT:

```bash
curl -X POST https://APP/api/sensors/readings \
  -H 'Content-Type: application/json' \
  -b "$COOKIE" \
  -d '{"readings":[{"sensorId":"...","value":7.4},{"sensorId":"...","value":88.1}]}'
```

---

## Despliegue en Google Cloud

La guía detallada paso a paso está en `DESPLIEGUE.md`. Resumen del camino:

1. **Preparar el proyecto para PostgreSQL** (cambia el motor y genera la migración inicial):

   ```bash
   ./scripts/use-postgres.sh
   ```

2. **Crear la instancia de Cloud SQL** y aplicar el esquema:

   ```bash
   gcloud sql instances create maintrack --database-version=POSTGRES_16 \
     --tier=db-f1-micro --region=us-central1
   gcloud sql databases create maintrack --instance=maintrack
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   ```

3. **Guardar los secretos** (`cmms-database-url`, `cmms-auth-secret`, `cmms-cron-secret`)
   en Secret Manager.

4. **Publicar** — Cloud Build construye la imagen a partir del `Dockerfile`, sin
   necesidad de tener Docker instalado:

   ```bash
   gcloud run deploy maintrack-cmms --source . --region us-central1 \
     --add-cloudsql-instances=PROYECTO:REGION:maintrack \
     --set-secrets="DATABASE_URL=cmms-database-url:latest,AUTH_SECRET=cmms-auth-secret:latest,CRON_SECRET=cmms-cron-secret:latest" \
     --allow-unauthenticated
   ```

5. **Crear su empresa real** (no los datos de demostración):

   ```bash
   DATABASE_URL="postgresql://..." npm run bootstrap -- \
     --empresa "Su Empresa" --nombre "Su Nombre" \
     --correo "usted@empresa.mx" --clave "una-contrasena-larga"
   ```

6. **Programador automático** — genera los preventivos vencidos cada hora:

   ```bash
   gcloud scheduler jobs create http maintrack-pm \
     --schedule="0 * * * *" --time-zone="America/Monterrey" \
     --uri="https://SU-SERVICIO.run.app/api/cron/scheduler" \
     --http-method=GET --headers="Authorization=Bearer EL_CRON_SECRET"
   ```

Con `.github/workflows/deploy.yml`, cada push a `main` vuelve a desplegar solo. El flujo
incluye una revisión previa que detiene el despliegue si el esquema quedó en SQLite, si
falta la migración inicial o si se versionó una base de datos por error.

Para volver a trabajar en local con SQLite: `./scripts/revert-sqlite.sh`.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión (SQLite en desarrollo, PostgreSQL en producción) |
| `AUTH_SECRET` | Clave de firma de sesión, mínimo 32 caracteres |
| `CRON_SECRET` | Token del endpoint de tareas programadas |
| `APP_URL` | URL pública de la aplicación |
| `ALLOW_PUBLIC_SIGNUP` | `true` habilita el alta abierta de organizaciones. Déjelo apagado en una URL pública: si no, cualquiera puede crear organizaciones en su instancia |

---

## Estructura

```
app/
  (app)/            Pantallas autenticadas (shell con navegación)
  api/              Rutas REST
  login/ register/  Acceso y alta de organización
lib/
  scheduler.ts      Motor de programación preventiva
  predictive.ts     Clasificación, regresión y vida remanente
  workorders.ts     Flujo de estados, costeo y consumo de almacén
  kpi.ts            MTTR, MTBF, disponibilidad, cumplimiento y costos
  rbac.ts           Matriz de permisos por rol
  auth.ts           Sesión JWT y contraseñas
prisma/
  schema.prisma     28 modelos, portable SQLite ↔ PostgreSQL
  seed.ts           Planta de demostración con 6 meses de historial
  migrations/       Migración inicial de PostgreSQL para producción
scripts/
  use-postgres.sh   Cambia a PostgreSQL y genera la migración inicial
  revert-sqlite.sh  Regresa a SQLite para desarrollo local
  bootstrap.ts      Crea la primera organización real en producción
```

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # compilación de producción
npm run db:reset   # recrea el esquema y recarga la demostración
npm run db:studio  # explorador de datos de Prisma
npm run db:migrate # aplica migraciones (producción)
npm run bootstrap  # crea la primera organización real
```
