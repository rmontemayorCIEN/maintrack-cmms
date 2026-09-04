# MainTrack CMMS

SaaS multi-inquilino de mantenimiento preventivo, correctivo y predictivo, vendido
a empresas mexicanas. Next.js 15 (App Router) + Prisma + PostgreSQL en Cloud Run.

**El idioma del proyecto es el espanol.** Nombres de funciones, variables,
comentarios, mensajes de error y textos de pantalla. Los nombres de modelos de
Prisma y campos de base de datos estan en ingles por historia; no los traduzcas.

---

## Reglas que no se rompen

Cada una de estas existe porque ya fallo. No son preferencias de estilo.

### 1. El esquema de Prisma es portable

Desarrollo corre en **SQLite** y produccion en **PostgreSQL 16** con el mismo
`schema.prisma`. Por eso:

- **Nada de `enum` nativo.** Se usa `String` mas un objeto `const` de TypeScript.
- **Nada de arreglos nativos** (`String[]`, `Int[]`).
- Migraciones generadas con el esquema apuntando a SQLite las rechaza
  PostgreSQL. El despliegue lo detecta y **bloquea**.

Para crear una migracion usa `scripts/nueva-migracion.sh`, nunca
`prisma migrate dev` a mano.

### 2. El inventario se mueve en un solo lugar

`aplicarMovimiento()` en `lib/almacen.ts` es el **unico** punto donde cambia el
stock. Valida, calcula costo promedio ponderado, escribe el kardex, actualiza
`PartStock` (la verdad) y refresca `Part.quantityOnHand` (un cache), todo en una
transaccion.

Escribir `quantityOnHand` directo deja el kardex mintiendo y el costo mal. Si
necesitas mover existencias, pasa por ahi.

### 3. Los esquemas de IA validan la forma, no el largo

El modelo **no respeta `maxLength` de forma estricta**. La API acepta el esquema
sin error, el modelo escribe veinte caracteres de mas y la respuesta —ya
generada y ya pagada— muere al validar.

- Los limites de texto van con `textoIa(max, descripcion)` de `lib/ia/cliente.ts`:
  el limite viaja en la descripcion, donde el modelo si lo lee, y se recorta al
  recibir.
- **Nunca `z.string().max()`** en un esquema de IA. El despliegue lo bloquea.
- Tampoco `maxItems` ni `minItems` mayor que 1 en arreglos: la API los rechaza
  con 400. `depurarEsquema()` los quita, y hay pruebas que lo cuidan.
- Los limites duros van al **escribir** en la base, no al leer del modelo.

### 4. Los numeros los calcula TypeScript, no el modelo

La IA interpreta; no hace aritmetica sobre renglones crudos. Totales, costos,
promedios, conteos y tendencias se calculan en codigo y se le entregan ya
resueltos. Un modelo sumando columnas es un error silencioso esperando fecha.

### 5. Toda pantalla nueva trae su ficha de ayuda

`lib/ayuda.ts` alimenta **dos** cosas: el panel de ayuda y la ayuda con IA. Una
pantalla sin ficha deja ciega a la IA. `scripts/revisar-ayuda.ts` reporta en los
dos sentidos —pantallas sin ficha y fichas huerfanas— y corre en el despliegue.

Si una pantalla legitimamente no necesita ayuda, va en `SIN_AYUDA`, no se ignora.

### 6. Factorizar antes de repetir

Peticion explicita de Rafael: *"siempre que sea factible optimiza tu codigo, eso
ayuda al orden y performance"*. Antes de copiar logica a una segunda pantalla,
extrae lo comun. Ejemplos vivos: `TablaConfigurable`, `CONTROLES_TABLA`,
`withAuth`, `aplicarMovimiento`.

### 7. Cada organizacion ve solo lo suyo

42 modelos llevan `organizationId`. Toda consulta lo filtra. Las rutas de API
pasan por `withAuth(permiso, handler)` de `lib/api.ts`, que entrega `orgId` ya
resuelto —incluida la suplantacion de super-admin. No leas la sesion a mano.

---

## Como esta armado

| Capa | Donde |
|---|---|
| Pantallas | `app/(app)/` — con sesion; `app/reportar`, `app/mis-reportes`, `app/solicitud` son publicas |
| API | `app/api/` |
| Logica de negocio | `lib/` (un archivo por dominio) |
| Funciones de IA | `lib/ia/` (una por funcion, mas `cliente.ts` como puerta unica) |
| Pruebas y utilerias | `scripts/` |

**Autenticacion**: JWT propio (jose, HS256, 7 dias) en cookie httpOnly; bcryptjs.
**Permisos**: matriz en `lib/rbac.ts` — 7 roles. VIEWER no tiene ninguno, o sea
que es de solo lectura por construccion, no por revisar cada pantalla.

### Las funciones de IA

Registradas en `lib/ia/funciones.ts`. Todas entran por `analizarConIa()` o
`conversarConIa()` en `lib/ia/cliente.ts`, que resuelve modelo, salida
estructurada, y **registra el consumo** (tokens y costo, exito o fallo).

Cuando algo de IA falle, el detalle esta en la tabla `AiUsage`, columna `error`.
`scripts/ultimo-error-ia.ts` lo saca. **Leelo antes de suponer la causa.**

---

## Comandos

```bash
npm run dev                    # desarrollo (SQLite)
npx tsc --noEmit               # tipos
npm run actualizar             # desplegar a produccion (con migracion)
npm run actualizar -- --sin-migrar
./scripts/nueva-migracion.sh   # crear migracion
./scripts/con-produccion.sh scripts/<x>.ts   # correr un script contra produccion
```

`con-produccion.sh` abre la puerta de Cloud SQL, corre y **siempre la cierra**,
incluso si truena. La llave de IA la trae de Secret Manager sin pasar por la
terminal.

### Publicar: siempre `npm run deploy`

Nunca un `gcloud run deploy` a mano. El servicio de produccion, el que ven los
clientes, se llama **`maintrack-cmms`** (no `cmms`).

`scripts/deploy.sh` apunta al correcto y ademas conecta Cloud SQL, monta los
secretos y abre el servicio al publico. Un `gcloud run deploy` escrito a mano
se lleva todo eso: publica sin base de datos y sin llaves. Ya paso una vez —se
creo un servicio `cmms` de mas, que hubo que borrar.

### Lo que revisa el despliegue antes de publicar

1. Limpia duplicados de iCloud en `.next`
2. Rechaza migraciones con sintaxis de SQLite
3. `tsc --noEmit`
4. Fichas de ayuda faltantes (avisa, no bloquea)
5. Esquemas de IA compatibles con la API (**bloquea**)

### El guardian de secretos

`scripts/git-hooks/pre-commit` revisa el contenido de cada commit y lo detiene
si encuentra una llave de Anthropic o de Google, una llave privada, o una
cadena de conexion con contrasena literal. Se activa con:

```bash
git config core.hooksPath scripts/git-hooks
```

Esa configuracion es local y **no viaja en el respaldo**: hay que correrla otra
vez despues de restaurar en otra computadora.

Las pruebas viven en `scripts/prueba-*.ts` y se corren con `npx tsx`.
`prueba-procedimiento-real.ts` llama al modelo de verdad: cuesta centavos y no
va en el despliegue.

---

## Las cuentas son de clientes en vivo

Casa Montemayor, Acero Industrial y Minerales Metalicos son cuentas de prueba
hoy, y se tratan como si fueran de paga. Pronto lo seran.

- **Ensayo antes de escribir en produccion**, y verificacion despues. Todo
  script que modifique datos lleva `--aplicar`; sin esa bandera solo reporta.
- **Migraciones aditivas.** Nunca borrar una columna con datos sin hablarlo.
- **Al cambiar un proceso, revisar todo lo que lee esos datos**, no solo lo que
  se toco. Los defectos aparecen en la pantalla de al lado: cuando el
  calendario paso a vivir en la asignacion, la proyeccion y la lista de planes
  quedaron mostrando fechas obsoletas y nadie lo habria notado.
- **Decirlo cuando algo quedo mal**, antes de que lo encuentre el.

## Como trabajar aqui

- **Verifica el orden de declaracion despues de insertar codigo.** Un bloque
  anclado despues de lo que lo usa da `ReferenceError` en tiempo de ejecucion y
  TypeScript no lo atrapa. Ya paso.
- **Lee el error real antes de proponer causa.** Hay registro en `AiUsage`, en
  los logs de Cloud Run y en la consola del navegador.
- **Prueba el ciclo completo antes de decir que funciona**, no solo que compila.
- **Los secretos nunca por la terminal.** Se cargan por la consola web de GCP o
  se leen de Secret Manager sin imprimirlos. Ya se quemaron dos llaves.
- Cuando algo se puede validar de forma determinista, se valida asi. La IA es
  para lo que no tiene formula, no para reemplazar una.
