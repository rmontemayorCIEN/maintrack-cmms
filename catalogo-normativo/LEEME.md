# Catálogo normativo

El contenido de las normas: qué exige cada una, cada cuándo y qué evidencia
deja. Vive aquí, en un paquete neutral, y **no dentro del código de MainTrack**.

## Por qué está separado

Mantener este contenido al día es trabajo continuo de alguien que sepa, y
sirve a más de un sistema: MainTrack lo aterriza en lo operativo —planes,
documentos, registros— y Avisos de Obligaciones lo aterrizaría en lo fiscal y
corporativo. Mantenerlo dos veces sería pagar dos veces por lo difícil.

**Hoy solo lo consume MainTrack.** Está preparado para más, no conectado a más.

## Cómo se comparte

Copiando `normas.json`. Nada más.

No hay servicio, ni llamadas en vivo, ni base compartida, y es deliberado: así
ningún sistema depende de que el otro esté arriba, y el orden en que un cliente
contrate uno u otro no importa. Cada consumidor guarda con qué `version` se
quedó y decide cuándo ponerse al día.

## Por qué en git y no en una base de datos

Porque es contenido con consecuencias legales. En git cada cambio queda con su
fecha, su autor y el texto exacto de lo que decía antes — y eso es lo que
permite contestar *«qué decía su catálogo en marzo»*, una pregunta que puede
aparecer después de una inspección. Una tabla editable no puede contestar eso.

## El contrato

`contrato` es la versión de la ESTRUCTURA; `version`, la del CONTENIDO.

- Si cambia el significado de un campo o se quita uno, sube `contrato` y los
  consumidores tienen que adaptarse.
- Si cambia lo que exige una norma, sube `version` (la del paquete) y también
  la `version` de esa norma. Eso es lo que hace que un consumidor pueda avisar
  «esto cambió desde que usted lo adoptó» sin leer el Diario Oficial.

```jsonc
{
  "contrato": 1,
  "version": 1,
  "publicado": "2026-09-27",   // ISO, día en que se publicó esta versión
  "revisadoPor": null,          // ← ver abajo. null = BORRADOR
  "normas": [
    {
      "clave": "NOM-002-STPS",  // identificador estable; NO cambia aunque cambie el título
      "titulo": "…",
      "emisor": "STPS",
      "giros": ["PLANTA", "…"], // a quién se le propone. Ver «giros».
      "resumen": "…",           // qué busca, en una línea
      "fueraDeAlcance": "…",    // OBLIGATORIO. Ver abajo.
      "version": 1,
      "obligaciones": [
        {
          "clave": "extintores", // estable dentro de la norma
          "titulo": "…",
          "detalle": "…",        // qué exige, en palabras de quien debe cumplirlo
          "tipo": "ACTIVIDAD",   // ver «tipos»
          "cadaDias": 30,        // opcional; ausente = no es periódica
          "evidencia": "…"       // qué tiene que quedar guardado
        }
      ]
    }
  ]
}
```

### `revisadoPor`

`null` significa **borrador**: el contenido lo redactó alguien que no es
especialista en seguridad e higiene. Mientras esté en null, el consumidor tiene
que decirlo en pantalla.

Cuando lo revise un especialista, se pone `{ "nombre": "…", "fecha": "2026-…" }`.
No se quita el campo: que esté y sea null es información.

### `tipos`

Qué **clase** de obligación es. No dice con qué se cumple —eso lo decide cada
sistema según lo que tenga—, dice de qué naturaleza es:

| tipo | Qué es |
|---|---|
| `ACTIVIDAD` | Algo que se hace cada cierto tiempo y deja evidencia |
| `DOCUMENTO` | Un papel que alguien expide, que vence y hay que renovar |
| `DATO` | Una medición o resultado que se lleva anotado |
| `RECORRIDO` | Caminar la instalación revisando puntos |
| `CAPACITACION` | Que quien hace el trabajo esté capacitado y se pueda demostrar |

En MainTrack, `ACTIVIDAD` y `RECORRIDO` se cumplen con un plan de
mantenimiento, `DOCUMENTO` y `CAPACITACION` con una vigencia, y `DATO` con un
registro propio. Otro sistema puede mapearlos distinto: el catálogo no le dice
cómo.

### `giros`

A qué clase de instalación se le propone la norma. Son los de
`lib/instalaciones.ts` de MainTrack, y **forman parte de este contrato**:
`PLANTA`, `EDIFICIO`, `PLAZA`, `HOSPITAL`, `ESCUELA`, `DEPORTIVO`, `HOTEL`,
`RESTAURANTE`, `BODEGA`, `FLOTILLA`, `RESIDENCIAL`, `OTRO`.

Un consumidor que no maneje giros puede ignorar el campo y ofrecer todo.

### `fueraDeAlcance` es obligatorio, y no es relleno

Dice lo que la norma pide y que **el sistema no lleva**. Existe para que el
cliente no crea que con esto ya cumplió todo. Una norma sin este campo se
rechaza al validar: es el único campo que está ahí para proteger al usuario de
nosotros.

## Al cambiarlo

1. Editar `normas.json`.
2. Subir `version` del paquete, y la `version` de cada norma que haya cambiado.
3. Correr `npx tsx scripts/revisar-catalogo-normativo.ts` — también corre en el
   despliegue y **bloquea** si algo está mal.

Lo que NO se debe hacer nunca: cambiar la `clave` de una norma o de una
obligación. Las claves son con lo que cada cliente tiene amarrado su trabajo;
cambiarlas deja huérfano lo que ya construyó. Si una norma se sustituye, se
agrega la nueva y se deja la vieja.
