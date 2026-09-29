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

### 8. Los avisos salen por `notify()`, no por donde sea

`notify()` en `lib/audit.ts` es el UNICO lugar por donde el sistema le dice
algo a una persona. Guarda la notificacion de la campana y, ademas, la manda
al celular si la organizacion tiene `avisosPush` encendido.

Un canal nuevo —WhatsApp, correo— se enchufa **ahi**, y lo ganan de golpe los
siete lugares que ya notifican. No se agrega un envio suelto en una pantalla:
esa es justo la forma de terminar con siete canales que se comportan distinto.

Dos cosas que no se tocan:

- **El registro va primero, el canal despues.** Si el envio falla, la
  notificacion ya quedo guardada y la persona la ve al entrar. Al reves se
  pierde el aviso cuando se cae el canal.
- **El canal nunca tumba la operacion.** Un fallo de envio no puede impedir
  que se cierre una orden de trabajo.

Los avisos al celular no cuestan por mensaje. Las llaves VAPID se generan una
sola vez con `scripts/generar-llaves-avisos.ts`, que **no imprime la privada**;
en produccion vive en Secret Manager. Regenerarlas obliga a cada persona a
volver a activar su telefono a mano.

---

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

### El servidor MCP del operador

`/api/mcp` deja que un agente de IA en claude.ai consulte cifras agregadas del
negocio, con OAuth y solo para el operador de la plataforma. Guia completa en
`Docs/mcp-operador.md`. Dos reglas:

- **Las herramientas (`lib/mcp/herramientas.ts`) usan `lectura`, nunca
  `prisma`.** `lectura` truena ante cualquier escritura; importar `prisma` ahi
  es saltarse la garantia de solo lectura, y `scripts/prueba-mcp.ts` lo detiene.
- **Solo agregados.** Una herramienta nueva no devuelve descripciones, equipos
  ni personas de los clientes: conteos, fechas y sumas por empresa.

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
./scripts/nueva-migracion.sh   # crear migracion
./scripts/con-produccion.sh scripts/<x>.ts   # correr un script contra produccion
```

### El proyecto NO vive en ~/Documents, y es a proposito

`~/Documents` en esta Mac **es** iCloud Drive: no es un enlace visible sino un
enlace firme de APFS, asi que `readlink` no dice nada y todo lo que este ahi se
sincroniza sin que se note.

Con el proyecto adentro eran 1.9 GB subiendo y bajando, y iCloud resuelve
conflictos creando copias con `" 2"` en el nombre. **No es cosmetico:** 147 de
esas copias dentro de `.next` dejaron el servidor de desarrollo sirviendo los
chunks del cliente con error 500 —la pagina cargaba, React nunca hidrataba, y
todo lo interactivo quedaba muerto sin un solo mensaje—. Se diagnostico dos
veces como si fuera un error del codigo.

El proyecto vive en `~/Proyectos/CMMS-V1`. **No lo regrese a `~/Documents`**,
ni al Escritorio, que tambien se sincroniza.

Y una leccion de un intento anterior: `~/Library/Caches` **no** es un lugar
donde guardar nada que haga falta. macOS la purga cuando necesita espacio, y
se llevo un `node_modules` completo sin avisar.

### Publicar: siempre por GitHub, nunca desde la Mac

Desde el 28 de septiembre de 2026 produccion se publica **solo** desde GitHub
(`rmontemayorCIEN/maintrack-cmms`). El camino es este y no tiene atajos:

1. **Rama nueva desde `main`** para cada cambio. Nunca se trabaja ni se hace
   commit directo en `main`, y no se mezclan dos temas en una rama.
2. **Pruebas locales** (`npx tsc --noEmit` y las `scripts/prueba-*.ts` que
   toquen lo cambiado), commit, `git push` y **pull request** contra `main`.
3. GitHub corre las pruebas (`pruebas.yml`) y levanta una **version de prueba**
   del PR (`vista-previa.yml`): etiqueta `pr-N`, sin trafico, contra la base de
   PRUEBAS. Rafael revisa ahi, no en produccion.
4. Rafael fusiona el PR. `produccion.yml` arranca y **se detiene esperando su
   aprobacion** en el environment `produccion`.
5. Al aprobar: anota la revision actual, migra, publica con `scripts/deploy.sh`,
   comprueba que la revision nueva es la que atiende, corre el humo y, si algo
   falla, regresa el trafico a la revision anterior.

**`npm run actualizar` y `npm run deploy` NO se corren desde la Mac.** Se saltan
las pruebas en GitHub y la aprobacion de Rafael. Siguen existiendo porque el
flujo de GitHub llama a `deploy.sh` por dentro; a mano, solo si Rafael lo pide
expresamente para una emergencia con GitHub caido, y diciendole que se salta la
puerta.

Lo que se aprendio con el camino anterior sigue valiendo, y el flujo ya lo
aplica solo: la migracion va **antes** de publicar (la revision 00108 salio
pidiendo columnas que la base no tenia y dejo caido el detalle de ordenes), y
las migraciones son aditivas para que la reversa funcione contra el esquema
nuevo.

### «Publica cambios» y «Libéralo»: las dos frases de Rafael

Rafael publica con dos frases. Cada una tiene un alcance fijo y **ninguna
incluye aprobar la liberación**: ese clic en GitHub es suyo y de nadie más.
Aunque `gh` tenga su sesión y la API lo permita, un agente nunca aprueba un
despliegue a `produccion`. Es el único punto del camino que un agente no pasa
solo, y aprobarlo con su sesión lo convertiría en decorado.

**«Publica cambios»** — hasta dejarle la versión de prueba:

1. `git status`: qué cambió y en qué rama. Si hay cambios de **otro tema** en la
   misma carpeta, no se meten al PR: se pregunta cuáles van.
2. Si está en `main`, rama nueva con nombre descriptivo en español
   (`la-cobranza-respeta-el-plan`). Nunca commit en `main`.
3. `npx tsc --noEmit` y las `scripts/prueba-*.ts` de lo que se tocó. Si algo
   falla, se corrige antes de subir.
4. Commit con el estilo de la casa (una frase que dice qué pasa ahora, cuerpo
   con el porqué), `git push -u origin <rama>` y `gh pr create` con el
   resumen en español.
5. Esperar las revisiones (`gh pr checks <n> --watch`). Si alguna sale en rojo:
   leer el registro (`gh run view <id> --log-failed`), corregir, volver a
   subir. Máximo dos intentos antes de explicarle a Rafael qué pasa.
6. Entregarle: liga del PR, liga de la versión de prueba (la deja
   `vista-previa.yml` como comentario en el PR), qué cambió en palabras de
   usuario y qué revisar ahí. **Aquí se detiene.**

**«Libéralo»** — de la fusión a confirmar lo que atiende:

1. Comprobar que el PR sigue en verde y sin commits nuevos sin revisar.
2. `gh pr merge <n> --merge --delete-branch`.
3. Avisarle que «Liberar a produccion» espera su aprobación en GitHub
   (*Actions → Review deployments → Approve*, también desde el celular).
4. Cuando apruebe, seguir la corrida (`gh run watch <id>`) y confirmar con el
   resultado: número de revisión nueva, que es la que atiende y que el humo
   pasó. Si hubo reversa, decirlo con la causa.
5. **Si la liberación publica sin haberle pedido aprobación**, la puerta no
   está funcionando: se le dice de inmediato y no se libera nada más hasta
   corregirla.

### El proyecto de Google Cloud va fijo, no el de la maquina

En esta Mac conviven sistemas independientes —MainTrack y Avisos de
Obligaciones, cada uno con su proyecto de GCP— y **no se mezclan**. La
configuracion global de `gcloud` es de la maquina y cambia segun en cual se
este trabajando: con ella apuntando a `avisos-obligaciones-4821`, el antiguo `actualizar`
fallo buscando `maintrack-db` ahi, y un `deploy` habria publicado MainTrack
dentro del otro proyecto.

Todo script que llama a gcloud carga `scripts/proyecto.sh`, que exporta
`CLOUDSDK_CORE_PROJECT=maintrack-cmms-4821` solo para ese proceso. Un comando
gcloud suelto se corre con esa variable o con `--project`. **Nunca**
`gcloud config set project`: rompe lo que este abierto en el otro sistema.

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
si encuentra una llave de Anthropic o de Google, una llave privada, la llave
VAPID de los avisos, o una cadena de conexion con contrasena literal. Se activa
con:

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
  quedaron mostrando fechas obsoletas y nadie lo habria notado. Como se hace
  esa revision esta en «"Se ve bien" no es haber probado», mas abajo.
- **Decirlo cuando algo quedo mal**, antes de que lo encuentre el.

## Antes de dar por bueno un cambio

Esta lista sale de defectos reales de este proyecto, no de teoria. Cada punto
costo encontrarlo tarde.

### 0. "Se ve bien" no es haber probado

Es la regla que manda sobre todas las demas, y la que mas caro ha salido
romper. Un cambio que compila, que se ve correcto en pantalla y que hace lo que
se pidio **todavia no esta probado**. Falta lo unico que importa: que no haya
descompuesto otra cosa.

Casi ningun defecto de este proyecto se anuncio. El plan que nunca generaba
ordenes se veia perfecto en la lista, con su fecha de vencimiento. La solicitud
que quedaba muerta al cancelar la OT se veia normal. El respaldo escribia
diligentemente en una carpeta que no salia de la Mac. Los tres pasaban la
prueba de "se ve bien".

**Que hacer, siempre, sin excepcion:**

1. `npx tsc --noEmit` — compila.
2. **TODAS** las pruebas, no las del cambio: `./scripts/suite.sh` — que ademas
   hace el build y corre la prueba de interfaz. Correr a mano las del cambio no
   es haber corrido la suite.
3. Si toco interfaz, abrirla en el navegador. Guardar bien no es mostrar bien.
4. Preguntarse **quien mas lee lo que toque**, y probar eso tambien:
   `grep -rn "loQueCambie" app/ lib/`

**Prueba cruzada:** el cambio de acentos toco 900 cadenas y compilaba; dos
pruebas de otros modulos fallaron porque comparaban contra textos que habian
cambiado. Nada en la pantalla lo habria mostrado. Tres veces en esa misma tarea
se acentuaron identificadores —una variable, un tipo, el nombre de una
propiedad— y las tres las detuvo el typecheck. Sin correr la verificacion
completa, los tres habrian llegado a produccion.

Cuando algo pase la revision y aun asi se sienta incierto, decirlo antes de
publicar. Es mas barato preguntar que corregir en vivo.

### 1. Que la prueba ejercite el sistema, no lo imite

El defecto mas caro fue este. La prueba del alta de planes creaba el plan y lo
asignaba **por su cuenta**, replicando al endpoint en vez de llamarlo. El
endpoint nunca asignaba. La prueba hacia lo correcto mientras el sistema hacia
lo incorrecto, y las dos pasaban.

**Regla:** si la ruta necesita sesion, saque su logica a una funcion de `lib/`
y que la ruta y la prueba llamen **la misma**. Asi se hizo con `altaDePlan` y
`armarOrden`. Una prueba que copia los pasos no prueba nada.

### 2. Escribir el dato no es suficiente: alguien tiene que leerlo

Un plan se creaba con `assetId` en el encabezado y se veia perfecto —con fecha
de vencimiento y todo— pero el programador itera `PlanAsset` y nunca lo miraba.
Diez planes que no generaron una sola orden, sin un solo aviso.

**Regla:** al agregar un campo, pregunte quien lo lee. Si nadie, esta escribiendo
un dato muerto. Al cambiar donde vive un dato, busque **todos** los lectores:

```
grep -rn "nombreDelCampo" app/ lib/ prisma/
```

### 3. Los defectos que callan son los peores

Ninguno de los grandes de este proyecto reventó. El plan sin asignacion, el
respaldo que no salia de la Mac, el gancho de secretos que dejaba pasar llaves:
los tres se veian bien. **Lo que se ve bien y no funciona es peor que un error
en pantalla.** Cuando algo deba pasar y no pase, tiene que decirlo.

### 4. Contar la verdad, no una aproximacion comoda

- El costo de una OT mezclada no se reparte entre sus fallas: se atribuye lo
  que si se puede y lo demas queda como gasto general. Repartirlo con una regla
  inventada da un numero preciso y falso.
- Un preventivo bien ejecutado no es una falla. Codificarlo mete un evento que
  nunca ocurrio en el Pareto y en el MTBF.
- Si no se puede saber, se dice que no se sabe.

### 5. Un criterio, un lugar

`recurrencia.ts` filtraba a correctivo y seguridad mientras Reportes contaba
cualquier OT con codigo. Dos numeros distintos para la misma pregunta y nadie
podia decir cual servia. Ahora `lib/fallas.ts` lo decide una sola vez.

**Regla:** si dos pantallas responden la misma pregunta, la respuesta vive en
`lib/`. Copiarla es garantizar que se desincronicen.

### 6. Probar los tres casos, no solo el que se arreglo

- El caso nuevo funciona.
- El caso viejo **sigue** funcionando (ordenes anteriores al cambio, planes de
  un solo equipo, cuentas sin datos).
- El caso que **no** debe pasar, no pasa. El gancho de secretos parecia servir
  hasta que se probo con una llave falsa: la dejaba pasar.

### 7. Verlo en pantalla, no solo en la base

El modal de cierre guardaba bien y **se contradecia a la vista**: mostraba el
aviso de que no se pedia codigo de falla y debajo dibujaba los campos. Ninguna
prueba de datos lo iba a ver.

**Regla:** todo cambio de interfaz se abre en el navegador antes de darlo por
bueno.

### 8. Trampas conocidas de este proyecto

- **`npm run build` con el servidor de desarrollo corriendo** corrompe `.next` y
  deja errores de modulo que no tienen nada que ver con el cambio. Deten el
  servidor, borra `.next`, compila, vuelvelo a levantar.
- **`npx prisma format` alinea columnas**, asi que cualquier anclaje de texto
  exacto sobre el esquema falla despues. Anclar por nombre de modelo o regex.
- **La base de desarrollo es SQLite local** y no comparte nada con produccion.
  Las contrasenas reales no sirven ahi (`scripts/clave-de-desarrollo.ts`).
- **Al insertar codigo, revisar el orden de declaracion.** Un bloque colocado
  antes de lo que usa da `ReferenceError` en ejecucion y TypeScript no lo ve.

### 9. Correr la suite COMPLETA, no las pruebas del cambio

Durante toda una sesion se corrieron siete pruebas —las relacionadas con lo que
se estaba tocando— y se dijo "todo pasa". Al correr las veinticuatro aparecio
una fuga entre empresas en `recuperarSeguimiento`, que llevaba ahi desde el
primer commit y no tenia nada que ver con el cambio del dia.

**Regla:** `ls scripts/prueba-*.ts` y correrlas todas. Las que fallen por falta
de llave de IA se nombran como tales; las demas se investigan.

### 10. Acotar SIEMPRE por organizacion, tambien en las pruebas

Los folios y numeros son unicos **por empresa**, no globales. Un
`findFirst({ where: { number } })` agarra el registro de otra cuenta en cuanto
hay mas de una, y en desarrollo hay cientos.

Esto aparecio dos veces el mismo dia: en una prueba (molesto) y en
`recuperarSeguimiento` de produccion (una fuga real entre empresas). La regla 7
aplica al codigo Y a las pruebas.

### El cierre, siempre

```
npx tsc --noEmit        # compila
./scripts/suite.sh      # TODAS las pruebas, el build y la interfaz
```

`suite.sh` revisa primero que el entorno no las vaya a arruinar —el esquema en
SQLite, ningun servidor de desarrollo compitiendo por `.next`— y al final
separa las fallas ESPERADAS de las que hay que mirar. «10 fallas» no dice
nada; «0 inesperadas» si.

La prueba de interfaz va **al final, con su propio build**, y no por gusto: usa
`next start`, y las trece pruebas que levantan `next dev` le pisan `.next`.
Cuando corria dentro del bucle caia siempre en «esperadas» y sus 92 revisiones
no se corrian NUNCA, con el resumen diciendo que no habia nada inesperado. Por
ahi se escapo una regresion de verdad.

Las `*-real` fallan sin `ANTHROPIC_API_KEY`: son de funciones de IA y se corren
con `./scripts/con-produccion.sh`, que trae la llave de Secret Manager.

Y la ficha de ayuda de la pantalla que se toco. Es regla, no cortesia.

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
