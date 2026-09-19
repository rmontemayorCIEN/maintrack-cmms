<!-- Generado por scripts/generar-documentos-comerciales.ts. No se edita a mano: cambie la fuente y vuelva a generar. -->

# Historias de la demostración

Se muestran en la **empresa demostrativa**, sobre el sistema real. Orden recomendado para 20 a 30 minutos: Lo que ve la dirección → Una falla, de principio a fin → Inventario y compras → Por uso y por condición → El preventivo que se programa solo.

## 1. Lo que ve la dirección (4 min)

- **Rol:** Dirección
- **Inicio:** La directora de planta entra el lunes a primera hora.
- **Problema:** Necesita saber qué está en riesgo y dónde se está perdiendo capacidad, sin pedir un reporte.

1. Como dirección (direccion@): el inicio muestra la situación crítica (refacción agotada que detiene trabajo), OT vencidas, cumplimiento, disponibilidad y costo.
2. Abra las dos OT vencidas: una es la revisión de la caldera, equipo crítico.
3. En Indicadores: tendencias y costo por equipo; la llenadora concentra las fallas.
4. En Dónde para la planta: qué equipos detuvieron la línea y cuánto costó.
5. Decisión: autorizar la compra pendiente y pedir que se revise la frecuencia de cambio de empaques de la llenadora.

**Resultado que se explica:** En cinco minutos, la dirección pasa de ver números a tomar dos decisiones concretas con evidencia.

**Registros:** Indicadores (/indicadores), Dónde para la planta (/paros)

## 2. Una falla, de principio a fin (5 min)

- **Rol:** Solicitante → Supervisión → Técnico → Supervisión → Dirección
- **Inicio:** El operador de llenado acaba de reportar que gotea producto por una válvula de la llenadora.
- **Problema:** Si la fuga sigue, se desperdicia producto y la válvula puede terminar parando la línea.

1. Como solicitante (operador@): muestre el reporte SS-000001 en «Mis reportes» y cómo se hace uno desde el QR del equipo.
2. Como supervisión (supervision@): en Solicitudes, apruebe SS-000001, conviértala en orden y asígnela a Luis Hernández.
3. Como técnico (mecanico@, en el teléfono): acepte e inicie la orden, abra el expediente de LLN-101, marque la actividad, registre 1 h, cargue un kit de empaques KIT-VLL del almacén y tome una foto.
4. Si faltara la refacción: pídala desde la orden con una requisición.
5. Termine la orden con la solución, la falla y la causa (Fuga · Fin de vida útil del componente).
6. Como supervisión: revise horas, costo, causa y evidencia, y cierre la orden.
7. Abra LLN-101: la orden, su costo y la falla ya están en el historial; es la tercera fuga en válvulas en tres meses.

**Resultado que se explica:** El reporte se atendió en minutos, con responsable, costo y causa registrados; la recurrencia de fugas en la llenadora queda a la vista para decidir.

**Registros:** Solicitud del operador (SS-000001), Llenadora LLN-101 (LLN-101), Kit de empaques (KIT-VLL)

## 3. Inventario y compras (5 min)

- **Rol:** Compras → Dirección → Compras → Técnico
- **Inicio:** El cambio de aceite del compresor está detenido: no hay elemento separador aire-aceite (FIL-SEP).
- **Problema:** Una refacción de 4,800 pesos detiene el servicio de un equipo crítico.

1. Como compras (compras@): en Almacén, FIL-SEP aparece agotado y bajo mínimo.
2. Cree la requisición de compra de 2 piezas con proveedor Aire Comprimido Industrial Delta.
3. Como dirección (direccion@): autorice la compra (también la RC-000002 de aceite, que ya espera su firma).
4. Como compras: registre la cotización, elíjala, emita la orden de compra y reciba el material.
5. Muestre el kardex: la entrada con su costo; y la orden del compresor, que ya puede continuar.

**Resultado que se explica:** La necesidad real (una orden detenida) se convirtió en compra autorizada y recibida; la existencia y el costo quedaron en el kardex y en la orden.

**Registros:** Elemento separador (FIL-SEP), Compras (/compras), Compresor CMP-201 (CMP-201)

## 4. Por uso y por condición (5 min)

- **Rol:** Supervisión → Técnico
- **Inicio:** El compresor CMP-201 tiene un sensor de temperatura de descarga, y el montacargas un horómetro con servicio cada 250 horas.
- **Problema:** La temperatura del compresor sube medio grado al día desde que se limpió su enfriador: ya pasó el límite de advertencia (95 °C) y va hacia el crítico (105 °C).

1. En Alertas: abra la alerta del compresor; muestre la tendencia y la fecha estimada del cruce crítico.
2. Cree la orden desde la alerta y asígnela.
3. Como técnico: registre la limpieza del enfriador y termine la orden.
4. En Predictivo: registre una lectura de 83 °C y valide la normalización de la alerta.
5. En Medidores: el montacargas MON-301 está a 18 h de su servicio; el sistema ya generó la orden por horas.

**Resultado que se explica:** El trabajo se hizo antes de la falla, por la condición real del equipo y no por calendario, y la alerta quedó cerrada con evidencia.

**Registros:** Compresor CMP-201 (CMP-201), Alertas (/alerts), Medidores (/meters)

## 5. El preventivo que se programa solo (4 min)

- **Rol:** Supervisión → Técnico
- **Inicio:** La llenadora, el equipo más crítico, tiene un plan semanal de lubricación y revisión de válvulas.
- **Problema:** Sin plan, la lubricación depende de que alguien se acuerde; con el plan, el sistema genera la orden y mide si se cumplió.

1. Como supervisión: abra el plan «Lubricación y revisión de válvulas de la llenadora»: actividades, frecuencia, refacción y responsable.
2. Muestre la orden que el sistema ya generó para los próximos días, asignada a Luis Hernández.
3. Como técnico: ejecute la lista de verificación, capture la presión de llenado (1.8 a 2.4 bar) y termine.
4. Como supervisión: cierre la orden.
5. Vea el cumplimiento preventivo en el inicio y la siguiente fecha en el plan.

**Resultado que se explica:** El preventivo se generó, se ejecutó con lista de verificación y medición, y el cumplimiento se actualizó sin capturar nada aparte.

**Registros:** Planes preventivos (/plans), Llenadora LLN-101 (LLN-101)

## Recorrido guiado (dentro de la demo)

1. **Cada rol empieza en lo suyo** — el inicio (`/dashboard`): La dirección ve la situación crítica y cuatro indicadores; supervisión, el trabajo del día; el técnico, sus órdenes. Nadie busca: el sistema pone enfrente lo que toca.
2. **El expediente de cada equipo** — los activos (`/assets`): Trece equipos con su criticidad y ubicación. Abra la llenadora LLN-101: historial, costo, fallas, planes y refacciones en una sola pantalla.
3. **El trabajo, bajo control** — las órdenes (`/work-orders`): Cada orden con responsable, fecha y estado. Hay dos preventivos vencidos —uno es la caldera, crítica— y uno detenido por una refacción agotada.
4. **El preventivo se programa solo** — los planes (`/plans`): Diez planes por calendario y por horas. El sistema genera las órdenes a tiempo y mide el cumplimiento.
5. **Antes de que falle** — las alertas (`/alerts`): La temperatura del compresor viene subiendo desde que se limpió su enfriador. La alerta dice cuándo cruzará el límite crítico y deja crear la orden desde ahí.
6. **Refacciones ligadas al trabajo** — el almacén (`/inventory`): El elemento separador del compresor está agotado y detiene un preventivo. El almacén lo marca bajo mínimo, con kardex y costo promedio.
7. **De la requisición a la recepción** — compras (`/compras`): Una compra completa del mes pasado —cotización, orden, recepción— y otra que espera la firma de dirección.
8. **Los números, al día** — los indicadores (`/indicadores`): Disponibilidad, cumplimiento, costo, MTBF y MTTR calculados por el sistema con lo que se registró, con su fórmula a la vista.
9. **Dónde se pierde capacidad** — Dónde para la planta (`/paros`): Qué equipos y qué áreas detienen la línea, cuántas horas y cuánto cuesta. Aquí se decide dónde invertir primero.
10. **Así arranca un cliente** — la puesta en marcha (`/puesta-en-marcha`): Los pasos para dejar una empresa lista para operar, con importación desde hojas de cálculo. Es lo que haría su equipo el primer día.

## Preguntas de quien presenta

- **¿Los datos son reales?** No. La empresa demostrativa, sus personas, proveedores y cifras son de ejemplo. La historia de 90 días se generó con los mismos procesos del sistema, por eso los números cuadran.
- **¿Puedo capturar durante la demostración?** Sí: todo funciona igual que en una cuenta real. Al terminar, restaure la demo para dejarla lista para la siguiente.
- **¿Qué no se puede hacer aquí?** Cambiar el plan, crear credenciales de API o conectar avisos a otros sistemas: la demo no sale de sí misma.
- **¿Las fechas se ven viejas?** Las fechas son relativas al día en que se restauró. Si la demo lleva semanas sin restaurarse, restáurela antes de presentar.
- **¿Qué rol uso?** El que indique la historia. Las cuentas son dirección@, gerencia@, supervision@, mecanico@, electrico@, compras@, operador@ y calidad@, del dominio de la demo.

## Restaurar la demo

Dentro de la demo: **Guía de la demostración › Restaurar la demo** (dirección o gerencia), escribiendo RESTAURAR. Fuera de ella:
`npx tsx scripts/empresa-demostrativa.ts --restaurar` (ensayo) y `--restaurar --aplicar`; en producción, a través de `./scripts/con-produccion.sh`.
Se conservan la empresa y las cuentas; todo lo demás vuelve a su estado inicial con fechas al día y queda en la auditoría.
