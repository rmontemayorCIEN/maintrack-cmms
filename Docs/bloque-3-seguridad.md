# Bloque 3 — Seguridad SaaS y administración empresarial

El objetivo no es un certificado: es poder venderle MainTrack a tres empresas
distintas y dormir tranquilo. Que ninguna vea lo de otra, que los permisos sean
de verdad, que las llaves se puedan quitar y que quede escrito quién hizo qué.

## Cómo está resuelto el aislamiento

Toda ruta de la API pasa por `withAuth(permiso, handler)` en `lib/api.ts`, que
resuelve la sesión y entrega `orgId` ya resuelto —incluida la suplantación del
operador de la plataforma—. Ninguna pantalla lee la sesión a mano.

De las 116 rutas, 12 no usan `withAuth`, y cada una por una razón:

| Ruta | Por qué | Qué la protege |
|---|---|---|
| `auth/login`, `auth/logout`, `auth/register`, `auth/restablecer` | son la puerta | freno por intentos, token de un solo uso |
| `publico`, `publico/olvidar` | el portal del QR escribe sin sesión | la organización sale del token del punto, nunca del navegador |
| `cron/*` (3) | las llama Cloud Scheduler | `Authorization: Bearer $CRON_SECRET` |
| `admin/*` (3) | panel del operador de la plataforma | `requireSuperAdmin()` |
| `billing/*` (2) | facturación del servicio | `requireSuperAdmin()` |

## Riesgos encontrados, con su severidad

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | **Cualquiera con sesión podía exportar todo a CSV** —órdenes, activos, inventario con costos—, incluido el rol de solo consulta | Alta | Corregido: permiso `data:export` y bitácora |
| 2 | Cambiar la contraseña **no cerraba** las sesiones abiertas: el JWT seguía vivo hasta 7 días | Alta | Corregido: `sessionsValidFrom` |
| 3 | **No había freno** a los intentos de acceso: probar contraseñas era gratis | Alta | Corregido: 10 fallos / 15 min por correo |
| 4 | No existía **recuperación de contraseña**; solo que un administrador dictara una nueva | Media | Corregido: liga de un solo uso, con vencimiento |
| 5 | Alta, baja y **cambio de rol de usuarios no quedaban en la bitácora** | Media | Corregido |
| 6 | **Reactivar** un usuario desactivado **saltaba el límite del plan** | Media | Corregido |
| 7 | Entrar y fallar al entrar no se registraba en ningún lado | Media | Corregido: `AccessAttempt` + bitácora |
| 8 | El almacén local de desarrollo aceptaba rutas con `..`, que salen del prefijo de la organización | Baja (solo desarrollo) | Corregido |
| 9 | Recuperar una solicitud del portal (folio + celular) no tenía freno de intentos | Baja | Corregido |
| 10 | La interfaz ofrecía «Exportar CSV» a roles que el servidor iba a rechazar | Baja | Corregido |
| 11 | **El QR público anunciaba la empresa, la planta, el área y el equipo completo** a cualquiera que lo escaneara | Alta | Corregido: por omisión solo el punto y la clave |
| 12 | **Un texto del portal podía volverse fórmula de Excel** al exportarlo (`=HYPERLINK(...)`) | Media | Corregido: `seguroParaHoja()` en todo el CSV |
| 13 | El freno del portal era por punto: cambiar de código lo evadía | Media | Corregido: también por origen |
| 14 | Un archivo que decía ser imagen podía ser cualquier cosa | Media | Corregido: se revisan los primeros bytes |
| 15 | La foto que no se podía guardar se perdía **en silencio** | Media | Corregido: la respuesta y la pantalla lo dicen |
| 16 | No había aviso de datos ni aviso de privacidad en el formulario público | Media | Corregido |
| 17 | La bitácora no se podía filtrar: 60 renglones para mirar, no para investigar | Media | Corregido: fecha, usuario, módulo y acción |
| 18 | Cerrar sesión y abrir un archivo no quedaban registrados | Baja | Corregido: `LOGOUT` y `FILE_ACCESSED` |

**Lo que se revisó y ya estaba bien:** el filtro por organización en las rutas
con identificador (24 intentos de cruce, todos rechazados), los archivos
adjuntos —URL firmada de 15 minutos, nombre aleatorio, prefijo por
organización—, el QR público, los límites de plan de activos, usuarios, sitios,
sensores y almacenamiento, el freno de reportes del portal, y que el rol se lea
de la base en cada petición, de modo que un cambio pega de inmediato.

## Matriz de roles

Es la misma que verifica `scripts/prueba-permisos.ts`, escrita ahí a mano para
que un cambio de matriz no pase inadvertido.

| Acción | OWNER | ADMIN | SUPERVISOR | TECHNICIAN | COMPRAS | REQUESTER | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Crear orden de trabajo | ✓ | ✓ | ✓ | | | | |
| Registrar horas y refacciones | ✓ | ✓ | ✓ | ✓ | | | |
| Completar (cierre técnico) | ✓ | ✓ | ✓ | ✓ | | | |
| Validar y cerrar | ✓ | ✓ | ✓ | | | | |
| Reabrir una orden cerrada | ✓ | ✓ | | | | | |
| Dar de alta activos y planes | ✓ | ✓ | ✓ | | | | |
| Levantar una solicitud | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| Revisar una solicitud | ✓ | ✓ | ✓ | | | | |
| Pedir material (vale) | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| Surtir, devolver y mover existencia | ✓ | ✓ | ✓ | ✓ | | | |
| Solicitar una compra | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Autorizar una compra | ✓ | ✓ | | | | | |
| Recibir material de compra | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Exportar información | ✓ | ✓ | ✓ | | | | |
| Configuración y catálogos (incluye proveedores) | ✓ | ✓ | | | | | |
| Administrar usuarios y contraseñas | ✓ | ✓ | | | | | |
| Facturación del servicio | ✓ | | | | | | |

**Consulta (VIEWER) no tiene ningún permiso**: es de solo lectura por
construcción, no por revisar pantalla por pantalla.

Esta misma tabla está **dentro del sistema**, en Configuración → Usuarios →
«Qué puede hacer cada rol». Se arma desde `lib/matriz-roles.ts`, que pregunta
por los mismos permisos que aplica el servidor: si mañana cambia uno, la tabla
cambia con él y una prueba lo verifica.

## Sesiones, contraseñas y recuperación

- La sesión es un JWT propio (HS256, 7 días) en cookie `httpOnly`, `sameSite:
  lax`, `secure` en producción. Las contraseñas se guardan con bcrypt.
- **Revocación**: `User.sessionsValidFrom`. Al cambiar la contraseña —propia o
  repuesta por administración—, al cambiar el rol, al desactivar a alguien y al
  usar «cerrar sesión en todos los dispositivos», toda sesión emitida antes
  deja de servir en la siguiente petición.
- **Recuperación**: la administración genera una liga desde «Usuarios». Vence en
  **60 minutos**, sirve **una sola vez**, solo se ve al generarla y el token no
  se guarda en claro —solo su hash SHA-256—. Al usarla, cierra las sesiones
  abiertas de esa persona. Una liga nunca cruza de una empresa a otra: se emite
  buscando a la persona dentro de la organización de quien la pide.
- **Freno**: 10 fallos en 15 minutos por correo cierran la puerta, y mientras
  dura, ni la contraseña correcta pasa. El mensaje es el mismo para un correo
  inexistente que para una contraseña equivocada.
- **No hay correo saliente todavía**: por eso la liga la entrega un
  administrador. El día que haya dominio propio, se manda por `notify()` sin
  tocar nada de lo anterior.

## Archivos y QR

- Los objetos **nunca son públicos**: cada descarga se firma al momento y vence
  en 15 minutos. El nombre en el almacén es un UUID bajo `org-<id>/…`, así que
  ni revela el nombre original ni permite adivinar el de otra empresa.
- Pedir un adjunto de otra organización da 404; sin sesión, 401.
### El QR público

Un código pegado en un pasillo lo escanea cualquiera: el repartidor, la visita,
quien pase por la banqueta. Por eso **muestra lo mínimo por omisión**:

| Se muestra siempre | Solo si se enciende a propósito |
|---|---|
| La clave del equipo (`CMP-301`) o el nombre del punto de lugar | El nombre de la empresa |
| | La planta y la ubicación interna |
| | El nombre completo del equipo |

Las tres opciones viven en cada punto (Solicitudes → Puntos de reporte → «Qué
muestra al escanear») y cambiarlas queda en la bitácora. Apagadas, **el reporte
sigue llegando con su equipo, su área y su planta**: eso se guarda igual; lo que
cambia es lo que se le enseña a quien escanea.

Nunca se muestra —ni con opciones— historial, costos, personal, órdenes internas
ni documentos.

Además:

- **Aviso de datos** en el formulario, con enlace al aviso de privacidad de la
  empresa si lo configuró, o al del sistema (`/privacidad`) si no.
- **Freno doble**: 10 reportes por punto cada 10 minutos y 10 envíos por origen
  cada 15. Cambiar de código no evade el segundo. Sin CAPTCHA: la frecuencia
  basta y un CAPTCHA estorba a quien de verdad quiere reportar.
- **Texto saneado** al entrar: sin caracteres invisibles, con largo acotado, y
  blindado contra fórmulas al exportarse.
- **La foto se verifica de verdad**: se revisan los primeros bytes. Lo que no sea
  la imagen que dice ser no entra al almacén, y quien reportó se entera.
- **Respuesta idéntica** para un código inventado, uno vencido y uno desactivado.

## Límites de plan

Se aplican en el servidor con `verificarCupo()` antes de crear: activos,
usuarios, sitios, sensores y almacenamiento. Las funciones de IA se resuelven
con `iaDeLaOrganizacion()` y responden con mensaje claro cuando el plan no las
incluye. Al llegar al tope, la respuesta es **402** con el texto que ve el
usuario. Reactivar un usuario cuenta como alta.

Una cuenta con la prueba vencida queda en **solo lectura**, pero **sí puede
exportar su información**: sus datos son suyos.

## Auditoría

La bitácora se **filtra por fecha, usuario, módulo y acción** (Configuración →
Auditoría), y los filtros viven en la URL: un hallazgo se comparte pegando la
dirección. Trae hasta 200 renglones por consulta; para ir más atrás se acotan
las fechas.

`logAudit()` escribe organización, usuario, entidad, identificador, acción,
resumen y cambios. Nunca contraseñas, hashes ni tokens. **No existe en todo el
sistema una función que edite o borre un registro de la bitácora**, y hay una
prueba que lo verifica sobre el código. Acciones registradas de
este bloque: `LOGIN`, `LOGIN_FAILED`, `USER_CREATED`, `USER_ROLE_CHANGED`,
`USER_DEACTIVATED`, `PASSWORD_CHANGED`, `PASSWORD_RESET_ISSUED`,
`PASSWORD_RESET_USED`, `SESSIONS_REVOKED`, `LOGOUT`, `EXPORTED`, `FILE_ACCESSED`. Se suman a las que ya
existían: ajustes de inventario, autorizaciones, cancelaciones y cambios de
configuración. Se ven en Configuración → Auditoría.

**Eliminar una organización no existe** como función. Una cuenta se suspende o
se cancela desde el panel del operador, y queda en la bitácora.

## Respaldo y recuperación

| Qué | Cómo |
|---|---|
| **Base de producción** | Respaldo automático diario de Cloud SQL a las 08:00 UTC, se conservan 7 |
| **Momento exacto** | Recuperación a un punto en el tiempo (PITR) con 7 días de bitácora de transacciones |
| **Antes de cada migración** | Respaldo manual bajo demanda, lo hace `npm run actualizar` solo si hay migraciones pendientes |
| **Limpieza** | `scripts/respaldo-base.sh` borra manuales de más de 30 días, siempre después de uno nuevo exitoso y conservando al menos 3 |
| **Código y migraciones** | `scripts/respaldar.sh` empaqueta el repositorio completo a Google Drive; se conservan 7 días |
| **Quién puede restaurar** | Solo quien tenga acceso al proyecto `maintrack-cmms-4821` de Google Cloud |

**Restaurar la base** (no se ejecuta sin decisión explícita):

```bash
gcloud sql backups list --instance maintrack-db --project maintrack-cmms-4821
# 1. Clonar a una instancia NUEVA y verificar ahí, sin tocar producción:
gcloud sql instances clone maintrack-db maintrack-db-rescate \
  --point-in-time '2026-09-17T22:00:00Z' --project maintrack-cmms-4821
# 2. Revisar los datos en la copia.
# 3. Solo entonces decidir: repuntar el servicio o traer los renglones que falten.
```

Restaurar **una sola organización** no se hace con el respaldo completo: se
clona a la instancia de rescate y se copian sus renglones. El respaldo es de
toda la base; la separación entre clientes es por `organizationId`, no por base.

**Validado el 17 de septiembre de 2026**, sin tocar producción: el último
respaldo bajo demanda figura como `SUCCESSFUL`, el automático diario y el PITR
están encendidos, y el respaldo del repositorio se restauró en una carpeta
temporal —124 puntos de historia, íntegro—.

## Pruebas

| Prueba | Qué ejercita |
|---|---|
| `scripts/prueba-aislamiento.ts` | 24 intentos de cruce entre empresas por identificador, 12 listados y pantallas, sin sesión, QR público, traspasos |
| `scripts/prueba-permisos.ts` | los 7 roles contra 17 acciones, llamando a la API directo, más la coincidencia de la interfaz |
| `scripts/prueba-acceso.ts` | sesiones revocadas, ligas de un solo uso, freno de intentos, archivos, límites de plan, exportación y bitácora |
| `scripts/prueba-portal-publico.ts` | el QR mínimo y el configurado, códigos inválidos y desactivados, saneamiento de texto, fórmulas de Excel, foto falsa, freno por punto y por origen |
| `scripts/prueba-bitacora.ts` | los filtros uno por uno y combinados, el aislamiento de la bitácora, y que la referencia de roles diga lo mismo que aplica el servidor |

Las tres levantan la aplicación y llaman a las rutas con una sesión firmada,
igual que el navegador: un filtro que exista en `lib/` pero que la ruta no
aplique, ahí se ve.

## Pendientes reales

- **No hay correo saliente**: la liga de restablecimiento la entrega un
  administrador. Es una limitación operativa, no un hueco.
- El freno de acceso cuenta por **correo**, no por IP. Frena la fuerza bruta
  contra una cuenta; no frena a quien pruebe muchos correos distintos.
- Las sesiones **no se pueden listar** («estos son sus dispositivos»): se pueden
  cerrar todas, pero no una sola. Requeriría guardar cada sesión emitida.
- El registro de intentos (`AccessAttempt`) **no se purga solo** todavía.
- El aviso de privacidad del sistema describe lo que MainTrack hace; **no
  sustituye el aviso legal de cada empresa**, que se configura aparte.
- La descarga de un archivo ya firmada sigue sirviendo hasta 15 minutos aunque
  el adjunto se borre. Es la contraparte de no exponer URLs permanentes.
