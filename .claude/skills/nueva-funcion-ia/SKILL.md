---
name: nueva-funcion-ia
description: Agregar una funcion de IA a MainTrack. Usar cuando se construya cualquier capacidad nueva que llame al modelo — diagnostico, sugerencia, lectura de foto, analisis de texto — o cuando se modifique el esquema de una funcion existente. Cubre el contrato completo: registro, esquema, prompt, ruta, permisos, ayuda y pruebas.
---

# Agregar una funcion de IA

Catorce funciones ya siguen este contrato. Saltarse un paso no rompe la
compilacion: rompe en produccion, con el usuario enfrente.

## Antes de escribir codigo

Pregunta si esto necesita IA. La respuesta correcta muchas veces es no:

- ¿Hay formula? Entonces es codigo. Los minimos de inventario y la prediccion
  por medidor se decidieron **sin** IA a proposito.
- ¿Se resuelve con patrones? `lib/riesgo.ts` detecta fugas de gas al instante,
  sin modelo y sin costo.
- ¿Ya lo cubre otra funcion? Antes de crear una nueva, mira si extender una
  existente es mas limpio. La ayuda con IA se hizo extendiendo `/consulta`, no
  construyendo un segundo cerebro.

La IA es para lo que no tiene formula.

## Los pasos

### 1. Registrar la funcion

En `lib/ia/funciones.ts`: agrega el nombre al tipo union y su entrada al
registro (que hace, modelo, limites, si el operador puede usarla).

### 2. El archivo de la funcion

Uno nuevo en `lib/ia/<nombre>.ts`. Adentro:

**El esquema de salida.** Zod, y validando **forma, no largo**:

```ts
titulo: textoIa(180, "La accion, en imperativo y concreta."),
detalle: textoIa(500, "Como se hace, si no es obvio.").nullable(),
```

- Nunca `z.string().max()` — el modelo no respeta `maxLength` y la respuesta
  completa muere al validar. El despliegue bloquea si aparece.
- Nunca `maxItems` ni `minItems` mayor que 1 — la API los rechaza con 400.
- Cada campo con `.describe()` util. Es lo que el modelo lee para saber que
  quieres.

**La funcion.** Firma como las demas:

```ts
export async function generarX(
  org: OrgConIa,
  params: { ...; userId?: string | null; operador?: boolean },
): Promise<{ ok: true; ...; costoUsd: number } | { ok: false; motivo: string }>
```

Empieza con `puedeUsarIa(org, "NOMBRE", { operador })`. Devuelve `ok: false` con
**motivo claro en espanol** cuando falten datos —"la orden no tiene activo
asignado, sin saber a que equipo se le hace el procedimiento seria generico"—.
Negarse bien es parte de la funcion, no un caso de error.

**El contexto.** Los numeros ya calculados en TypeScript. El modelo interpreta,
no suma.

### 3. Anclas contra la invencion

Sin esto el modelo inventa con seguridad y el usuario le cree:

- Las refacciones salen del **catalogo del cliente**, con codigo exacto.
- Se le dan las **reparaciones anteriores** del mismo activo.
- Nada de torques, normas ni capacidades inventadas. Si no lo sabe, que lo diga.

### 4. La ruta

`app/api/ia/<nombre>/route.ts`, con `withAuth(<permiso>, ...)`.

Si la ruta escribe lo que la IA genero, **ahi** van los limites duros —y
recortando, no rechazando:

```ts
const recortado = (max: number) =>
  z.string().trim().transform((t) => t.slice(0, max));
```

Rechazar en la frontera de escritura tira trabajo ya pagado.

### 5. La pantalla

Boton con estado de carga, y el `motivo` de un `ok: false` mostrado tal cual: ya
viene redactado para el usuario.

### 6. La ayuda

Ficha en `lib/ayuda.ts`, con el boton nuevo en `botones`. Si no, la ayuda con IA
no sabe que existe. `scripts/revisar-ayuda.ts` avisa.

### 7. Las pruebas

- `npx tsx scripts/prueba-esquemas-ia.ts` — en seco, corre en el despliegue y
  **bloquea**.
- Un ciclo real contra produccion antes de decir que funciona. Usa
  `scripts/prueba-procedimiento-real.ts` de molde: genera de verdad y pasa el
  resultado por el validador de escritura. Cuesta centavos; sale mas barato que
  que el usuario encuentre el error.

## Cuando algo falle

El detalle esta guardado, aunque la pantalla no lo muestre:

```bash
./scripts/con-produccion.sh scripts/ultimo-error-ia.ts
```

Leelo **antes** de proponer causa. Cuatro intentos fallidos seguidos se
resolvieron en uno cuando por fin se consulto ese registro.
