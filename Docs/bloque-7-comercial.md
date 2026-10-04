# Bloque 7 — Preparación comercial y cuenta demostrativa

## Diagnóstico inicial (antes de cambiar)

- **Identidad:** «MainTrack CMMS» en título, acceso, menú e impresos; «MainTrack» en correos y ayuda. Sin descripción central. El acceso le hablaba al comprador en jerga («API REST», «MTTR, MTBF»). Acentos faltantes en textos visibles.
- **Sitio:** no existía; `/` redirigía al acceso.
- **Planes:** una sola fuente (`lib/planes.ts`) y límites aplicados en código, sin precios distintos entre pantallas. Pero: «contacte a su proveedor» junto a un botón para subir de plan; «suspendida» cuando en realidad es solo lectura; «Más contratado» sin respaldo; «Soporte prioritario» sin definir; claves internas (`IA_AVANZADA`) a la vista del operador; aviso de cargos duplicado; la prueba de 30 días escrita en tres lugares.
- **Cobro:** manual (notas de cobro, sin CFDI, sin suspensión automática), sin decirlo en ningún lado.
- **Soporte y legal:** sin canal de soporte ni términos, contrato o SLA; el aviso de privacidad solo cubría el reporte por QR.
- **Demo:** dos «demos» distintas (3 equipos «[DEMO]» del alta, y la planta de Acero Industrial). La segunda, sin compras reales, almacén que no cuadraba con el kardex, consumos anteriores al inventario inicial, paros incoherentes, textos repetidos, causas al azar, lecturas imposibles, alertas contradictorias, solicitudes convertidas sin orden y un nombre real como dueño. Restaurar = borrar y recrear a mano, sin registro.

## Decisiones de Rafael (19 sep 2026)

Precios actuales y **1 mes gratis**; soporte **solo dentro de MainTrack**, L-V 9-18 (Monterrey), tiempos de respuesta, sin porcentaje de disponibilidad; **empresa demostrativa nueva** (Acero Industrial intacta); sitio en la raíz.

## Qué se hizo

| Tema | Dónde |
|---|---|
| Fuente única comercial (descripción, problemas, diferenciadores, comparación, prueba, cobro, soporte, FAQ, respaldos verificados en Cloud SQL) | `lib/comercial.ts` |
| Documentos legales (10 borradores, versión aceptada al contratar) | `lib/legal.ts`, `/legal`, `/legal/[documento]` |
| Sitio comercial y solicitud de demostración (validación, aviso de privacidad, duplicados, campo trampa, 5 por hora) | `app/page.tsx`, `components/publico/*`, `lib/prospectos.ts`, `/api/prospectos` |
| Contratación (plan, precio, límites, complemento, documentos, modalidad inicial; con alta cerrada «solicitud recibida») | `/contratar`, `/api/contratar` |
| Alta única de empresas (registro, operador y demo) | `lib/alta-empresa.ts` |
| Prospectos y seguimiento (estado, demostración realizada, resultado, motivo de pérdida) | `/clients/prospectos` |
| Soporte con folio, severidad, tiempos objetivo por plan, escalamiento y respuesta del operador | `lib/soporte.ts`, `/soporte`, `/clients/soporte` |
| Empresa demostrativa: semilla, restauración, guía, recorrido, banda, bloqueos | `lib/demo-comercial.ts`, `lib/demo-guia.ts`, `/demo`, `components/demo/*`, `scripts/empresa-demostrativa.ts` |
| Identidad «MainTrack» y textos de acceso | `app/layout.tsx`, `app/manifest.ts`, `app/login`, menú, impresos |
| Incongruencias de planes y cobro | suscripción, `settings/planes`, `clients/panel`, `lib/cobranza.ts`, `billing/generate`, `admin/organizations/[id]` |
| Documentos comerciales generados | `scripts/generar-documentos-comerciales.ts`, `Docs/comercial` |
| Migración aditiva | `prisma/migrations/20260919002308_bloque7_comercial_y_demo` |

## La empresa demostrativa

Planta de envasado de bebidas: 1 sitio, 5 ubicaciones, 13 activos (A/B/C), 8 personas ficticias (@demostrativa.maintrack.mx), 10 planes (8 por calendario, 2 por horas), 3 horómetros, 2 sensores, 10 refacciones, 1 almacén, 4 proveedores, 90 días de historia (29 preventivos y 8 correctivos cerrados, cada uno con su causa y solución), una compra completa y otra por firmar, 4 solicitudes, 11 órdenes abiertas en todos los estados, una alerta por tendencia y los avisos que el propio sistema detecta. Todo se siembra por los caminos reales (almacén, compras, lecturas, programador, transiciones) y en orden cronológico; las fechas son relativas al día de restauración.

Punto de partida de cada historia: SS-000001 pendiente (falla), preventivo de la llenadora generado (preventivo), alerta del compresor y montacargas a 18 h (condición), FIL-SEP agotado deteniendo una orden y RC-000002 por firmar (compras), y dos OT vencidas con la caldera entre ellas (dirección).

Bloqueos: no cambia de plan, no crea credenciales ni webhooks, no genera cargos, no se suspende; mientras se restaura responde 503.

## Presentar al cliente

**Guía de la demostración › Iniciar la presentación** (`/demo/presentacion`, solo en la empresa demostrativa): 18 diapositivas a pantalla completa, una a la vez, con índice por secciones (Apertura · Por qué · El sistema · Casos · Cómo se trabaja · Cierre). Se avanza con las flechas, PageUp/PageDown o espacio; Escape sale.

- Las cinco historias son cinco diapositivas, cada una con sus botones para abrir la pantalla real de la demo. El número de diapositiva va en la dirección (`?d=9`) y se escribe con `replaceState`: al volver del sistema con «Atrás» se retoma en la misma, y avanzar no llena el historial.
- Todo sale de `lib/demo-presentacion.ts`, que solo ordena lo que ya dicen `lib/comercial.ts`, `lib/planes.ts` y `lib/demo-guia.ts`. Ningún precio ni promesa escrito a mano en la diapositiva.
- El documento `Docs/comercial/generados/presentacion.md` se genera de ahí mismo, así que nunca dice algo distinto de lo que se proyecta.
- Cada historia gana ligas (solicitudes, órdenes, almacén, requisiciones, predictivo, indicadores, inicio), filtradas por lo que el rol puede abrir.

## Procedimiento de restauración

- **Dentro de la demo:** Guía de la demostración › Restaurar la demo (Propietario o Administrador). Muestra qué se conserva (empresa, configuración, cuentas y contraseñas) y qué se restaura; se confirma escribiendo RESTAURAR.
- **Fuera:** `npx tsx scripts/empresa-demostrativa.ts --restaurar` (ensayo) y `--restaurar --aplicar`. En producción, con `./scripts/con-produccion.sh`.
- Cómo funciona: candado en la base (`demoRestaurandoDesde`) que rechaza una segunda restauración y hace responder 503 a la demo; borra solo los datos de esa empresa, en el orden que dicta el esquema (`Prisma.dmmf`), sin tocar la empresa ni las cuentas; vuelve a sembrar; queda `DEMO_RESTORED` en la auditoría. Si falla, suelta el candado y registra `DEMO_RESTORE_FAILED`; se puede reintentar. Solo actúa sobre organizaciones con `esDemo`.
- **Crear la demo en producción** (una sola vez, con autorización): `./scripts/con-produccion.sh scripts/empresa-demostrativa.ts --aplicar`. Imprime la contraseña de las cuentas una vez (o toma `DEMO_CONTRASENA`).

## Pruebas

| Prueba | Cubre |
|---|---|
| `prueba-comercial.ts` | Demo limpia y coherente (activos, ubicaciones, planes, inventario = kardex, costos, OT, indicadores, sin cargos, catálogos sin duplicados); las 5 historias por HTTP con el rol de cada una; restauración (permisos, palabra, concurrencia, 503, estado inicial, auditoría, otras empresas intactas); guía y recorrido; comparación y precios en sitio, contratación y suscripción; solicitud de demostración (validación, duplicado, trampa, límite, aviso al operador, seguimiento); contratación abierta y cerrada, prueba de 30 días y su vencimiento; cambio de plan; documentos; soporte; aislamiento; ligas rotas; acentos y marca |
| `prueba-responsiva.ts` (sección Bloque 7) | Sitio, contratación y documentos en 390 y 1440; solicitud de demostración desde el teléfono; demo en el teléfono con banda y recorrido (omitir, no reaparece, reiniciar); pantallas de las historias por rol en 390 |

## Riesgos y pendientes

- **Legal:** borradores; faltan razón social, RFC, domicilio, medio para derechos ARCO, ley aplicable y límite de responsabilidad. Revisión profesional antes de usarlos.
- **Impuestos:** los precios no dicen si incluyen IVA; los documentos remiten a la propuesta comercial. Hay que decidirlo.
- **Tiempos de soporte:** son objetivos que Rafael debe poder sostener solo (4 h hábiles una crítica en Professional, 2 h en Enterprise).
- **Correo:** no hay proveedor conectado; las confirmaciones solo se ven en pantalla y los avisos al operador en la campana. Nadie recibe correo de «solicitud recibida».
- **Alta abierta:** en producción `ALLOW_PUBLIC_SIGNUP` no está activo; `/contratar` registra solicitudes. Abrirla es una decisión aparte.
- **Demo en producción:** no existe todavía; se crea con autorización. Scripts viejos de la demo de Acero (`sembrar-contexto-demo.ts`, `sembrar-costo-demo.ts`) escriben sin `--aplicar`.
- **Límite por dirección** de las solicitudes es en memoria: por instancia de Cloud Run.
- **Presentación pública:** la presentación en diapositivas vive solo dentro de MainTrack (`/demo/presentacion`, empresa demostrativa). **Pendiente, decidido el 19 de septiembre de 2026: dejarla para después.** La versión pública —en el sitio, sin entrar al sistema, para mandarla antes de la reunión— implica repetir las diapositivas sin los botones que abren pantallas reales, que es justo lo que la hace distinta de un archivo de PowerPoint. Si se hace, sale del mismo `lib/demo-presentacion.ts` con las ligas vacías; el trabajo real es decidir qué se enseña sin sesión y si se pide correo para verla.
