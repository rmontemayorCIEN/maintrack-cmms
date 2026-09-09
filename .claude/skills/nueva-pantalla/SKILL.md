---
name: nueva-pantalla
description: Agregar una pantalla o un listado a MainTrack. Usar al crear cualquier vista nueva bajo app/(app), al sacar una seccion a su propia pantalla, o al agregar una lista de registros. Cubre multi-inquilino, permisos, tabla configurable, ficha de ayuda y las trampas de layout ya conocidas.
---

# Agregar una pantalla

## 1. Donde va

- `app/(app)/<ruta>/page.tsx` — requiere sesion, hereda el shell
- `app/<ruta>/` en la raiz — publica, sin sesion (`reportar`, `mis-reportes`,
  `solicitud`). Una pantalla publica **no** filtra por sesion: el acceso se
  controla por token en la URL.

## 2. Datos: siempre por organizacion

Toda consulta filtra por `organizationId`. En rutas de API usa
`withAuth(permiso, handler)` de `lib/api.ts`, que ya resuelve `orgId` incluyendo
la suplantacion de super-admin. No leas la sesion a mano.

Pasa `null` como permiso para lecturas; un permiso no nulo implica escritura y
ahi tambien se aplica el control comercial.

## 3. Si es un listado, usa la tabla configurable

`components/tabla-configurable.tsx`. Ya la usan seis pantallas y trae columnas
visibles, orden, filtro, agrupacion en tres niveles, expandir/colapsar todo, y
guardar o resetear la vista.

**No copies una tabla nueva.** Si te falta algo, extiendelo ahi: lo ganan las
seis. Esa es la peticion explicita de Rafael sobre factorizar.

Define cuales columnas son fijas (en Activos son Codigo y Activo) y cuales puede
mover el usuario.

## 4. Borrar necesita guardas

Nada se borra si tiene relaciones vivas. El patron de Activos: revisa planes,
consumos, mediciones y ordenes; si hay algo, no borres y **di que lo bloquea**,
con nombre y cantidad. Un "no se puede" sin motivo no sirve.

## 5. La ficha de ayuda es obligatoria

En `lib/ayuda.ts`, tipo `FichaAyuda`:

- `que` — para que sirve la pantalla, en una linea
- `hacer` — lo que el usuario logra aqui
- `flujo` — los pasos, en orden
- `campos` — que significa cada columna, diciendo la **consecuencia**, no
  repitiendo la etiqueta. "vencimiento: cuando debio estar hecha" no ayuda;
  "en rojo cuando ya paso, y el numero son los dias vencidos" si.
- `botones` — que hace cada boton propio
- `tablaConfigurable: true` si aplica, en vez de repetir los controles
- `noPuedo` — sintomas comunes y su causa

Alimenta el panel de ayuda **y** la ayuda con IA. Sin ficha, la IA queda ciega
en esa pantalla.

Si de verdad no necesita ayuda, agregala a `SIN_AYUDA`. Comprueba con:

```bash
npx tsx scripts/revisar-ayuda.ts
```

## 6. Trampas ya pagadas

- **`fixed` dentro del shell no funciona.** El `backdrop-blur` de la barra
  superior crea bloque contenedor. Los paneles flotantes usan `createPortal` a
  `document.body`, como `components/shell/ayuda.tsx`.
- **Las ventanas usan `components/ui/dialogo.tsx`, no un armazon copiado.** El
  patron copiado a mano (`fixed inset-0 grid place-items-center` sin
  `overflow-y-auto`) se ve perfecto mientras el contenido cabe y deja el pie
  FUERA DE ALCANCE cuando crece: en el cierre tecnico de una orden con varias
  actividades el boton de completar quedaba inalcanzable, sin nada en pantalla
  que lo explicara. Estaba asi en 12 de 21 ventanas. Con `pie`, el encabezado y
  los botones quedan fijos y solo se desliza el contenido.
- **Un `<select>` cuyo valor no esta entre sus opciones miente**: muestra la
  primera y conserva el valor viejo. Deriva el valor efectivo en cada render.
- **Movil primero en lo que el usuario lee de golpe.** Casi todos los reportes
  entran por celular; si el estatus es la segunda columna, no se ve sin
  desplazarse.
- **Revisa el orden de declaracion** despues de insertar un bloque. Anclarlo
  despues de lo que lo usa da `ReferenceError` y TypeScript no lo atrapa.

## 7. Antes de cerrar

```bash
npx tsc --noEmit
npx tsx scripts/revisar-ayuda.ts
```

Y abre la pantalla de verdad. Que compile no es que funcione.
