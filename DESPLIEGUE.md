# Publicar MainTrack CMMS en Google Cloud

Secuencia de comandos para dejar el CMMS en línea sobre Cloud Run + Cloud SQL.
Los valores `ASÍ` son suyos y hay que sustituirlos.

- **Tiempo:** 45–60 min · **Costo:** ≈ 12–28 USD/mes · **Región:** `us-central1`
- No hace falta Docker: la imagen se construye en Cloud Build.
- Cada paso termina con un resultado esperado. Si no aparece, no avance.

---

## 1. Instalar gcloud (macOS Apple Silicon)

> **macOS trae Python 3.9 y el CLI de Google necesita 3.10 o superior.** Si instala
> gcloud sin resolver esto primero, el instalador falla a media ejecución con
> `TypeError: unsupported operand type(s) for |`. Por eso el Python va primero.

**1a. Python moderno** (el mismo 3.14.7 que Google empaqueta):

```bash
cd ~/Downloads
curl -O https://www.python.org/ftp/python/3.14.7/python-3.14.7-macos11.pkg
open python-3.14.7-macos11.pkg
```

Instalador gráfico: *Continuar → Instalar*. Pide la contraseña de su Mac.
Compruebe que quedó:

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -V
```

Debe responder `Python 3.14.7`.

**1b. El CLI de Google**, indicándole qué Python usar:

```bash
export CLOUDSDK_PYTHON=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3

# El SDK va en su carpeta personal: ~/Downloads se vacía
cd ~
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
tar -xzf google-cloud-cli-darwin-arm.tar.gz
rm google-cloud-cli-darwin-arm.tar.gz

./google-cloud-sdk/install.sh --quiet --path-update false
```

**1c. Registrarlo en su terminal.** macOS usa **zsh** por omisión, pero algunas
terminales abren **bash**, y cada uno lee un archivo distinto. Este bloque detecta
cuál está usando y escribe en el correcto:

```bash
if [ -n "$BASH_VERSION" ]; then PERFIL=~/.bash_profile; SUF=bash
else                            PERFIL=~/.zprofile;    SUF=zsh; fi

{
  echo ""
  echo "# Google Cloud CLI"
  echo "export CLOUDSDK_PYTHON=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
  echo ". '$HOME/google-cloud-sdk/path.$SUF.inc'"
  echo ". '$HOME/google-cloud-sdk/completion.$SUF.inc'"
} >> "$PERFIL"

echo "Configuración escrita en $PERFIL"
```

Cierre la terminal, abra una nueva y conéctese:

```bash
gcloud version
gcloud auth login
```

**Resultado:** `gcloud version` responde y `gcloud auth list` muestra su correo.

**Si falla:**

- `TypeError: unsupported operand type(s) for |` — gcloud sigue tomando el Python 3.9.
  `CLOUDSDK_PYTHON` no quedó puesta: revise 1c y abra una terminal nueva.
- `command not found: gcloud` — casi siempre las líneas del paso 1c quedaron en el perfil
  de otro shell: **zsh lee `~/.zprofile` y no lee `~/.bash_profile`**. Compruebe con
  `echo $0` en qué shell está y revise que ese archivo tenga las líneas. Abra siempre una
  terminal nueva después de editarlo.

---

## 2. Proyecto y facturación

El identificador es único en todo Google Cloud, por eso lleva número.

```bash
gcloud projects create MAINTRACK-CMMS-4821 --name="MainTrack CMMS"
gcloud config set project MAINTRACK-CMMS-4821

gcloud billing accounts list
gcloud billing projects link MAINTRACK-CMMS-4821 --billing-account=0X0X0X-0X0X0X-0X0X0X
```

**Resultado:** `billingEnabled: true`.

---

## 3. Habilitar servicios

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com
```

---

## 4. Cloud SQL (tarda ~10 min)

```bash
gcloud sql instances create maintrack-db \
  --database-version=POSTGRES_16 \
  --edition=enterprise \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=08:00

gcloud sql databases create maintrack --instance=maintrack-db
gcloud sql users create maintrack --instance=maintrack-db --password='LA-CONTRASEÑA-QUE-USTED-ELIGIO'
```

> `--edition=enterprise` no es opcional: sin él Cloud SQL asume *Enterprise Plus*, que
> rechaza `db-f1-micro` y cuyo modelo más chico tiene 16 GiB de RAM — cientos de USD al mes.

> **La contraseña no debe contener `@ : / ? # & %`.** Viaja dentro de una URL de
> conexión y esos símbolos la parten en dos. El error resultante
> (*authentication failed*) no dice nada sobre la causa real.

**Resultado:** `gcloud sql instances list` muestra `RUNNABLE`.

---

## 5. Preparar el código para PostgreSQL

```bash
cd "/Users/rafaelmontemayor/Documents/BILLS/GOOGLE CLOUD PROJECTS/CMMS-V1"
./scripts/use-postgres.sh
```

Cambia el motor en `prisma/schema.prisma` y genera la migración inicial —
el SQL que crea las 28 tablas. El script verifica solo que el SQL sea de
PostgreSQL y no de SQLite.

Para volver a desarrollar en local: `./scripts/revert-sqlite.sh`.

---

## 6. Crear las tablas

```bash
MI_IP=$(curl -s https://api.ipify.org)
gcloud sql instances patch maintrack-db --authorized-networks="$MI_IP/32" --quiet

IP_DB=$(gcloud sql instances describe maintrack-db \
  --format="value(ipAddresses[0].ipAddress)")

export DATABASE_URL="postgresql://maintrack:LA-CONTRASEÑA-QUE-USTED-ELIGIO@$IP_DB:5432/maintrack?sslmode=require"
npx prisma migrate deploy
```

**Resultado:** `All migrations have been successfully applied.`

---

## 7. Secretos

La cadena que se guarda aquí **no es la del paso 6**: Cloud Run se conecta por
socket interno, sin salir a internet.

```bash
# Se lo pedimos a Google en vez de armarlo a mano: en zsh, "$VAR:us-central1"
# se interpreta como el modificador :u y deforma el valor.
INSTANCIA=$(gcloud sql instances describe maintrack-db --format="value(connectionName)")
echo "Anote: $INSTANCIA"   # debe tener 3 tramos: proyecto:region:instancia

printf '%s' "postgresql://maintrack:LA-CONTRASEÑA-QUE-USTED-ELIGIO@localhost/maintrack?host=/cloudsql/$INSTANCIA" \
  | gcloud secrets create cmms-database-url --data-file=-

printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create cmms-auth-secret --data-file=-
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create cmms-cron-secret --data-file=-
```

---

## 8. Permisos (el tropiezo más común)

```bash
PROYECTO=$(gcloud config get-value project)
NUMERO=$(gcloud projects describe $PROYECTO --format="value(projectNumber)")
CUENTA="$NUMERO-compute@developer.gserviceaccount.com"

for s in cmms-database-url cmms-auth-secret cmms-cron-secret; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:$CUENTA" \
    --role="roles/secretmanager.secretAccessor" --quiet
done

gcloud projects add-iam-policy-binding $PROYECTO \
  --member="serviceAccount:$CUENTA" \
  --role="roles/cloudsql.client" --quiet
```

---

## 9. Publicar (tarda ~7 min la primera vez)

```bash
cd "/Users/rafaelmontemayor/Documents/BILLS/GOOGLE CLOUD PROJECTS/CMMS-V1"

INSTANCIA=$(gcloud sql instances describe maintrack-db --format="value(connectionName)")

gcloud run deploy maintrack-cmms \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --add-cloudsql-instances="$INSTANCIA" \
  --set-secrets="DATABASE_URL=cmms-database-url:latest,AUTH_SECRET=cmms-auth-secret:latest,CRON_SECRET=cmms-cron-secret:latest"
```

**Resultado:** una URL terminada en `.run.app` que muestra la pantalla de acceso.

Si falla, la causa está en el registro de la construcción:

```bash
gcloud builds list --limit=1
gcloud builds log ID-DE-LA-CONSTRUCCION
```

---

## 10. Crear su empresa y su usuario

```bash
IP_DB=$(gcloud sql instances describe maintrack-db \
  --format="value(ipAddresses[0].ipAddress)")
export DATABASE_URL="postgresql://maintrack:LA-CONTRASEÑA-QUE-USTED-ELIGIO@$IP_DB:5432/maintrack?sslmode=require"

npm run bootstrap -- \
  --empresa "SU EMPRESA" \
  --nombre  "SU NOMBRE" \
  --correo  "usted@empresa.mx" \
  --clave   "SU-CONTRASENA-LARGA"
```

Entre con ese correo. El panel aparecerá en ceros: es lo correcto, todavía no
hay activos. El resto del equipo se da de alta desde **Configuración → Usuarios**.

---

## 11. Programador automático de preventivos

```bash
URL=$(gcloud run services describe maintrack-cmms --region us-central1 --format="value(status.url)")
CRON=$(gcloud secrets versions access latest --secret=cmms-cron-secret)

gcloud scheduler jobs create http maintrack-preventivos \
  --location=us-central1 \
  --schedule="0 * * * *" \
  --time-zone="America/Monterrey" \
  --uri="$URL/api/cron/scheduler" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON"

gcloud scheduler jobs run maintrack-preventivos --location=us-central1
```

---

## 12. Cerrar la puerta del paso 6

```bash
gcloud sql instances patch maintrack-db --clear-authorized-networks --quiet
```

Confirme también que `/register` responde *«Registro cerrado»*: el despliegue no
define `ALLOW_PUBLIC_SIGNUP`, así que nadie puede crear organizaciones en su
instancia. Para habilitarlo algún día: `--set-env-vars=ALLOW_PUBLIC_SIGNUP=true`.

---

## Opcional · Desplegar con `git push`

```bash
# Desde su carpeta personal, NUNCA dentro del proyecto: una clave dentro del
# repositorio acaba publicada en GitHub.
cd ~

PROYECTO=$(gcloud config get-value project)

gcloud iam service-accounts create github-deploy --display-name="Despliegue desde GitHub"
CUENTA_GH="github-deploy@$PROYECTO.iam.gserviceaccount.com"

for rol in roles/run.admin roles/cloudbuild.builds.editor \
           roles/artifactregistry.admin roles/iam.serviceAccountUser roles/storage.admin; do
  gcloud projects add-iam-policy-binding $PROYECTO \
    --member="serviceAccount:$CUENTA_GH" --role="$rol" --quiet
done

gcloud iam service-accounts keys create ~/clave-github.json --iam-account=$CUENTA_GH
```

En GitHub → *Settings → Secrets and variables → Actions*:

| Secreto | Valor |
|---|---|
| `GCP_CREDENCIALES` | Contenido completo del archivo. Cópielo sin mostrarlo con `pbcopy < ~/clave-github.json` y pegue con ⌘V |
| `GCP_PROYECTO` | El identificador del proyecto |
| `CLOUDSQL_INSTANCIA` | `proyecto:us-central1:maintrack-db` |

Compruebe primero que pesa ~2 KB (`ls -l ~/clave-github.json`); si son 0 bytes, el comando
falló y la cuenta de servicio no existe.

Después: `rm ~/clave-github.json`. Nunca debe crearse dentro de la carpeta del proyecto.

`.github/workflows/deploy.yml` incluye una revisión previa que detiene el
despliegue si el esquema quedó en SQLite, si falta la migración inicial o si se
versionó una base de datos por error.

---

## Cuando algo sale mal

| Lo que ve | Qué significa |
|---|---|
| `TypeError: unsupported operand type(s) for \|` | gcloud usa el Python 3.9 de macOS. Instale Python 3.14 y exporte `CLOUDSDK_PYTHON` (paso 1). |
| `Invalid Tier (db-f1-micro) for (ENTERPRISE_PLUS) Edition` | Falta `--edition=enterprise` en el paso 4. |
| ``the URL must start with the protocol `file:` `` | La imagen se construyó con el esquema en SQLite. El `Dockerfile` ya lo fuerza a PostgreSQL. |
| `Malformed CloudSQL instance string` | `$INSTANCIA` se armó mal: en zsh `"$VAR:us-central1"` activa el modificador `:u`. Obténgala con `gcloud sql instances describe maintrack-db --format="value(connectionName)"` y rehaga el secreto del paso 7. |
| `PERMISSION_DENIED` al leer un secreto | El paso 8 no se completó. Vuelva a correrlo entero. |
| `Can't reach database server at localhost` | Falta `--add-cloudsql-instances`, o `$INSTANCIA` se perdió al cerrar la terminal. |
| `password authentication failed` | La contraseña trae un símbolo que rompe la URL. Cámbiela y actualice `cmms-database-url`. |
| `P3005 database schema is not empty` | Las tablas ya existían. No es error: siga. |
| `does not have permission to act as service account` | Falta `roles/iam.serviceAccountUser` en la cuenta de GitHub. |
| La construcción falla sin explicar | `gcloud builds list --limit=1` y luego `gcloud builds log ID`. |
| Tarda ~4 s la primera visita | Arranque en frío. Es lo que lo hace gratis; suba a `--min-instances 1` si molesta. |

---

## Actualizar el sistema

Un solo comando hace todo: revisa el código, migra la base si hace falta,
publica y verifica.

```bash
npm run actualizar
```

Si el cambio no toca la base de datos, se salta la migración:

```bash
npm run actualizar -- --sin-migrar
```

**La puerta de Cloud SQL se abre lo mínimo y se cierra sola.** Está puesta en
una trampa de salida: se cierra aunque la migración falle, se pierda la red,
se suspenda la computadora o alguien presione Ctrl-C. Antes era el último paso
de una cadena de comandos, y un corte a la mitad dejaba la base expuesta a una
IP de internet sin que nadie se enterara.

El script se detiene antes de tocar nada si el código no compila o si detecta
una migración generada con el esquema en SQLite —esos tipos PostgreSQL los
rechaza, y ya nos costó una vez publicar código que consultaba tablas
inexistentes—.

Al terminar reporta el estado del sitio y confirma que Cloud SQL quedó sin
redes autorizadas. Si por alguna razón no pudo cerrarla, lo dice con el comando
exacto para hacerlo a mano.

### Cargar los catálogos estándar en una empresa

Se hace desde la aplicación, en **Puesta en marcha → Catálogos base**. Ya no
hace falta correr nada por terminal.

---

## Operación diaria

| Para | Comando |
|---|---|
| Ver la URL | `gcloud run services describe maintrack-cmms --region us-central1 --format="value(status.url)"` |
| Ver registros | `gcloud run services logs read maintrack-cmms --region us-central1 --limit 50` |
| Publicar un cambio | Repetir el paso 9, o `git push` |
| Ver respaldos | `gcloud sql backups list --instance=maintrack-db` |
| Volver a una versión | `gcloud run services update-traffic maintrack-cmms --region us-central1 --to-revisions=REVISION=100` |
| Apagar todo | `gcloud projects delete PROYECTO` |
