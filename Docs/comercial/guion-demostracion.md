# Guion de demostración (20 a 30 minutos)

Se presenta **en la empresa demostrativa**, sobre el sistema real. Antes de cada demostración: restaurarla (Guía de la demostración › Restaurar la demo) para que las fechas estén al día y no queden capturas de la anterior. Las historias, sus pasos y sus registros están en `generados/historias-demo.md` y dentro del producto en `/demo`.

## 1. Apertura y diagnóstico (5 min)

Antes de mostrar nada, preguntar:

1. ¿Qué mantienen? ¿Cuántos equipos, en cuántos sitios?
2. ¿Qué pasó la última vez que un equipo crítico paró? ¿Cuánto tardaron en enterarse y en resolverlo?
3. ¿Cómo saben hoy qué preventivos tocan esta semana y cuáles se hicieron?
4. ¿Qué pasa cuando falta una refacción?
5. ¿Qué número le pide la dirección y cuánto tardan en armarlo?
6. ¿Qué usan hoy: ERP, hojas de cálculo, libreta, otro sistema?

Anotar el **problema principal** en palabras del prospecto. De ese problema depende la historia que abre:

| Si lo que más le duele es… | Abrir con |
|---|---|
| Fallas y paros | Historia 1 (una falla de principio a fin) y cerrar con Dónde para la planta |
| Preventivos que no se cumplen | Historia 2 (el preventivo que se programa solo) |
| Refacciones que faltan | Historia 4 (inventario y compras) |
| La dirección no ve nada | Historia 5 (lo que ve la dirección) |
| Equipos que se degradan sin aviso | Historia 3 (por uso y por condición) |

## 2. Recorrido (15 a 20 min)

Orden recomendado si no hay un problema dominante: dirección → falla → compras → condición → preventivo. Cada historia dura de 4 a 5 minutos. Para cada una:

- **Decir el problema** con los datos de la demo («la llenadora ya tuvo dos fugas en válvulas este trimestre»).
- **Mostrarlo con el rol que corresponde** (la guía indica cuál): entrar como esa persona, no explicar su pantalla desde la del dueño.
- **Nombrar el resultado** y conectarlo con lo que el prospecto dijo en el diagnóstico.

Cuidar:

- No inventar funciones. Si preguntan por algo que no existe, se dice que no existe hoy.
- La inteligencia artificial apoya (diagnóstico, cierre, procedimientos); los números los calcula el sistema.
- En el teléfono, mostrar al técnico: la orden, la foto, el QR. Es donde se gana o se pierde la adopción.

## 3. Beneficios vinculados (3 min)

Resumir en tres frases, cada una atada a algo que el prospecto vio y a su problema. Ejemplo: «Vio que el reporte del operador llegó a la orden en un minuto y que el costo quedó en el equipo; hoy eso lo arma usted a fin de mes».

## 4. Preguntas de validación (2 min)

- ¿Esto resolvería lo que me contó al principio?
- ¿Quién de su equipo lo usaría primero?
- ¿Tiene la lista de equipos en una hoja de cálculo?
- ¿Qué tendría que pasar para empezar una prueba?

## 5. Objeciones

**«Ya tenemos ERP.»** El ERP registra lo que ya pasó: la compra, la factura, la póliza. MainTrack dirige el mantenimiento antes y durante: qué toca, quién lo hace, qué refacción hace falta, qué equipo se está degradando. No lo sustituye: conviven, e intercambian información por API cuando hace falta.

**«Ya usamos hojas de cálculo.»** La hoja guarda lo que alguien captura cuando se acuerda. No genera el preventivo, no avisa al técnico, no detiene una orden porque falta la pieza ni calcula el costo por equipo. Y las hojas que ya tienen se importan: son el punto de partida.

**«Los técnicos no van a capturar.»** Por eso el técnico no captura una bitácora: registra lo que hace mientras lo hace, en su teléfono, en el orden del trabajo, con fotos en lugar de texto. Muéstrelo en el teléfono.

**«Implementarlo será complicado.»** La puesta en marcha guiada dice qué falta y en qué orden; los datos se importan desde hojas con vista previa y se pueden revertir. Se empieza por un área y los equipos críticos, no por toda la planta.

**«No tenemos datos ordenados.»** Casi nadie los tiene. Con una lista de equipos basta para empezar; los catálogos recomendados para su giro se cargan solos, y la calidad de los datos se revisa desde el sistema.

**«No queremos otro sistema.»** No es otro lugar donde capturar lo mismo: reemplaza las libretas, los mensajes y la hoja de preventivos. El dueño deja de pedir reportes: los ve al entrar.

**«No conocemos el retorno.»** No prometemos una cifra. Lo que sí se mide desde el primer mes: horas de paro por equipo y su costo (Dónde para la planta), cumplimiento preventivo y costo de mantenimiento. Propuesta: medir con sus datos durante la prueba.

**«La planta no puede detenerse para implementarlo.»** No se detiene nada: MainTrack se usa en paralelo, empezando por reportar fallas y registrar órdenes. Los preventivos se programan en los paros que ya tienen.

## 6. Cierre y siguiente paso

- Proponer una fecha concreta: prueba de un mes con sus equipos críticos, o una segunda sesión con el equipo de mantenimiento.
- Pedir: lista de equipos, responsable del lado del cliente y quién firma.
- Registrar en Empresas cliente › Prospectos: demostración realizada, plan de interés, resultado o motivo de pérdida.
- Al terminar: **restaurar la demo**.
