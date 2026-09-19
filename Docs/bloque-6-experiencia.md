# Bloque 6 — Experiencia por rol y operación móvil

## Diagnóstico inicial

**Por rol.** El menú era igual para los siete roles (57 pantallas; solo 7
revisaban el rol). Toda consulta de la API respondía a cualquiera con sesión
(`withAuth(null)`): el solicitante podía leer el catálogo de refacciones con
costos, todas las solicitudes de la empresa y la lista de usuarios con correo.
Los costos se veían en todas partes para todos. El detalle de OT por API
devolvía el registro completo del responsable, **incluido el hash de su
contraseña**. «Compras» existía en permisos pero no se podía elegir al crear
un usuario. Ajustes cargaba Usuarios, Auditoría y Estado de cuenta para
cualquier rol.

**Móvil.** Sin barra de navegación inferior; búsqueda oculta en teléfono;
nombre de la empresa invisible (vivía en el menú lateral). Todas las tablas
se desplazaban de lado. El detalle de OT ponía el equipo y la ubicación al
final y las acciones arriba. Las fotos se subían en cuanto se elegían, sin
vista previa, y el botón de borrar solo aparecía al pasar el cursor. Un
`fetch` sin señal dejaba botones girando o borraba lo escrito (la bitácora
vaciaba el campo aunque fallara). La edición de una OT mandaba todos los
campos y pisaba en silencio lo que otra persona hubiera cambiado. La ventana
de reporte usaba el armazón que se corta en pantallas chicas. 154 controles
de menos de 32 px en 390 px.

## Qué ve cada rol — `lib/pantallas.ts`

Una sola tabla de pantallas por rol. De ella salen el menú, la barra del
teléfono, las acciones rápidas, la guardia del servidor y las consultas de la
API (`withVista`). Una ruta nueva nace cerrada (solo mando) hasta que se abre.

- **Guardia**: `middleware.ts` pasa la ruta al layout, que responde «Esta
  pantalla no es de su rol» con el menú del rol alrededor. Una sola vez para
  las 57 pantallas.
- **Costos** (`verCostos`): dueño, administración, supervisión y consulta.
  Técnico y solicitante no; Compras ve costos de almacén y compras
  (`verCostosDeAlmacen`). Se quitan también de las respuestas de la API
  (`sinCostos`).
- **Solicitudes** (`veTodasLasSolicitudes`): quien revisa y consulta ven
  todas; solicitante y técnico, las suyas (el técnico, además, las de sus
  órdenes). Aplica a lista, detalle, fotos, búsqueda y API.

| Rol | Menú (resumen) |
|---|---|
| Propietario | Todo, más Facturación; Empresas cliente si es operador |
| Administrador | Todo menos Facturación |
| Supervisor | Operación, análisis, almacén y compras; sin Catálogos, Importar ni Puesta en marcha |
| Técnico | Inicio, tablero, calendario, sus solicitudes, alertas, órdenes, backlog, equipos, escanear, medidores, planes, almacén, requisiciones (sin Compras: pide material con un vale) |
| Compras | Inicio, almacén, requisiciones, compras, proveedores (también en sus acciones rápidas) |
| Solicitante | Inicio, Mis reportes, Escanear |
| Consulta | Operación y análisis en lectura; sin almacén, compras ni configuración |

## Inicio por rol — `lib/inicio.ts`

Una pantalla que pinta lo que arma `inicioDe()` para cada rol: resumen breve,
acciones rápidas y bloques de pendientes; cada registro una vez, colores con
palabras («Urgente», «Revisar», «Al día»), «Todo al día» si no hay nada.

| Rol | Resumen | Bloques |
|---|---|---|
| Propietario | OT vencidas, cumplimiento, disponibilidad, costo (4) | Puesta en marcha si falta, situación crítica, compras por firmar, alertas importantes, empresas cliente; «Más detalle» lleva a Indicadores y Reportes. Las gráficas y el desglose viven en Indicadores («Tendencias y desglose») |
| Administrador | Críticas, vencidas, compras, problemas de captura | Críticos, vencidas, configuración pendiente, planes con problemas, inventario crítico, compras, alertas, calidad de datos; ligas de Administración |
| Supervisor | Sin asignar, vencidas, para revisión, cumplimiento | Críticas, sin asignar, vencidas, vencen hoy/mañana, revisión, detenidas, preventivos de hoy, solicitudes, bloqueos por refacción, alertas, carga por técnico |
| Técnico | Para hoy, vencidas, críticas, detenidas | Críticas, vencidas, hoy, próximas, detenidas, avisos de su trabajo |
| Compras | Sin orden, OC abiertas, entregas vencidas, parciales | Sin orden de compra, entregas vencidas y de la semana, diferencias de recepción, por autorizar, bajo mínimo |
| Solicitante | En revisión, en atención, atendidos | Esperando revisión, en atención, no se atenderán (con motivo), atendidos; con la respuesta de quien revisa |
| Consulta | Abiertas, vencidas, críticas | Críticas, vencidas, alertas |

Acciones rápidas: las de cada rol, solo si la pantalla se abre y el permiso
existe (`accionesRapidasDe`).

## Teléfono

- **Barra inferior** con cuatro destinos del rol y «Menú» (abre el cajón;
  Escape o el fondo lo cierran; no se pierde la pantalla).
- **Orden de trabajo**: ficha (equipo, dónde, para cuándo, a cargo, avance,
  riesgos), índice del trabajo (actividades, seguridad, tiempo, materiales,
  lecturas, evidencias, bitácora, resultado) y acciones del paso siguiente
  fijas abajo en este orden: Aceptar (solo el responsable, antes de iniciar;
  queda en bitácora y auditoría y reconoce el aviso de asignación), Iniciar,
  Pausar o reportar bloqueo, Terminar y enviar a revisión, Pedir apoyo (lleva
  a la bitácora con la casilla marcada; avisa con `OT_APOYO_SOLICITADO`).
  Ficha: trabajo, equipo y ubicación, estado, prioridad, vencimiento.
  Secciones: verificación, riesgos, tiempo, materiales, lecturas, evidencias,
  bitácora y resultado (lo que se pedirá al terminar). Lo secundario
  —servicios, procedimiento con IA, material por actividad, historial y datos
  completos— va plegado en el teléfono (`components/plegable.tsx`) y abierto
  en computadora.
- **Tablas**: `TablaConfigurable` se ve como tarjetas en pantallas angostas
  (identificador, descripción, cuatro datos y «Más datos»), de 40 en 40; en
  computadora sigue siendo tabla. El filtro vive en la dirección (`?f=`) y
  sobrevive a «atrás». Búsqueda sin acentos ni mayúsculas.
- **Formularios**: una columna, campos de 16 px (el iPhone no hace zoom),
  teclado decimal en todo campo numérico, teléfono en contacto, botones de
  acción fijos al pie de las ventanas (no los tapa el teclado).
- **Controles** de 40 px mínimo en pantallas táctiles (regla global).

## Fotos, QR y conexión

- **Fotos** (`components/fotos-por-subir.tsx`, `lib/cliente/subida.ts`):
  tomar o elegir, ver, quitar, y subir al confirmar; orientación correcta y
  reducción a 2000 px en JPEG 85 %; tipo y tamaño validados antes; repetidas
  descartadas; progreso y reintento por archivo. El solicitante solo cuelga y
  abre fotos de sus reportes; cada archivo se abre solo si el rol ve su registro.
- **QR**: `/escanear` lee con la cámara dentro de MainTrack, también en
  iPhone: «Abrir cámara y escanear» pide la cámara (trasera) solo al tocarlo;
  lee con `BarcodeDetector` si existe y si no con jsQR (se descarga solo en
  ese momento); «Cancelar» la apaga. Lo leído se valida en el servidor
  (`lib/qr.ts`, `/api/qr`): que sea de MainTrack, de la empresa y que el rol
  pueda abrirlo; abre el activo, el punto de reporte o la OT. Errores con
  salida: permiso negado, sin cámara, sin conexión, código ajeno. Siempre se
  puede escribir la clave del equipo o el folio. El portal del punto, con sesión de la misma
  empresa, ofrece por rol: abrir el equipo, crear OT, registrar lectura,
  reportar con su usuario. Sin sesión o de otra empresa, el formulario público.
- **Sin conexión**: aviso fijo; `useBorrador` conserva lo escrito en la
  pestaña hasta 12 h (no en el teléfono indefinidamente) y `pedir()` distingue
  guardado / regla / sin red, para reintentar al volver la señal.

## Doble toque y cambios simultáneos

- Consumo de refacción y horas: candado en proceso + revisión de 10 s en la
  base (`lib/repeticion.ts`); el segundo responde 409 diciendo que el primero
  sí quedó. Cambios de estado: ya eran condicionales (no se repiten).
  Recepción: con clave. Solicitud y lectura: candado + 10 s (409). Aceptar:
  idempotente. Autorizar compra: condicional sobre el estado (la segunda
  firma dice que ya estaba firmada).
- Edición de OT: se mandan solo los campos cambiados con el valor que tenían
  al empezar; si otro los cambió, 409 con cuáles, se recarga lo vigente y lo
  capturado se queda en el formulario.

## Pruebas

| Prueba | Cubre |
|---|---|
| `prueba-experiencia.ts` | Los 7 roles: inicio, menú, pantallas por dirección, API, búsqueda; ciclo del técnico (iniciar, actividades, tiempo, material, lectura, foto, bloqueo, apoyo, terminar); supervisión (asignar, reasignar, devolver, cerrar); compras (pedir, no autoriza, colocar, recepción parcial); solicitante (foto, solo lo suyo); consulta sin cambios; QR público y con sesión; validación; doble toque; conflicto; cambio de empresa; otra empresa y sus archivos |
| `prueba-responsiva.ts` | Chrome sin ventana contra el build de producción: 7 roles (62 pantallas) y su menú abierto/cerrado en 320×568, 360×800, 390×844, 430×932, 768×1024, 1024×768 y 1440×900, con captura de las 13 pantallas principales en cada tamaño; URL de otro rol; QR con cámara simulada (permiso al tocar, trasera, jsQR y nativo, cancelar, permiso negado, manual, código ajeno); recorrido completo del técnico en 390 px con el supervisor en otra sesión; fotos (EXIF, reducción, varias, repetidas, tipo, 201 MB, falla de red y reintento, progreso, consulta, otra empresa); borrador ante menú, activo y atrás, otra pestaña, recarga y sin señal; conflicto de edición; barra en 320; horizontal; consola y peticiones; 4G. **Requiere `npm run build` y el servidor detenido**; tarda ~8 min |

## Riesgos y pendientes reales

- **Confirmar que se atendió** (solicitante) y **responder solicitudes de
  información**: el proceso actual no los contempla; ve el estado y la orden.
- **Operación sin conexión**: no la hay (fuera del bloque); solo se conserva
  lo escrito y se reintenta.
- **Controles pequeños**: quedan 68 en 23 pantallas en 390 px (ligas de
  texto, filtros de periodo de Indicadores, pasos numerados de puesta en
  marcha, subir/bajar actividad). Se pueden tocar, pero miden menos de 32 px.
- **Borrador**: se conserva lo escrito en la bitácora y en el reporte del
  solicitante. Horas, material y lectura son campos cortos y no se guardan
  como borrador: si la persona sale antes de registrar, se pierden.
- **QR en la prueba**: se probó con la cámara simulada de Chrome (lector
  nativo y jsQR). Falta confirmarlo en un iPhone y un Android reales con una
  etiqueta impresa.
- **Doble toque entre instancias**: el candado es por proceso; dos toques que
  caen en instancias distintas de Cloud Run los frena solo la revisión de 10 s.
- **Costos**: decisión tomada —consulta ve costos; técnico no—. Revisar si
  se quiere distinto.
- Pantallas no rediseñadas para teléfono más allá de la regla global y las
  tarjetas: calendario, tablero, lienzo del mapa, reportes (cabían sin
  desplazamiento lateral en la prueba, pero son de computadora).
