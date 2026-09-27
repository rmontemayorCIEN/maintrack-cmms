# Servidor MCP del operador

Un servidor MCP remoto para que un agente de IA en claude.ai consulte cifras
**agregadas** del negocio de MainTrack como operador de la plataforma. Es de
**solo lectura** y cada consulta queda en la bitácora.

## La URL del conector

```
https://maintrack-cmms-kgvakdu5hq-uc.a.run.app/api/mcp
```

Sale del encabezado `Host` que entrega Cloud Run, porque en producción
`APP_URL` no está puesta. Si algún día se pone un dominio propio y `APP_URL`
apunta a él, la URL del conector pasa a ser `<APP_URL>/api/mcp` y hay que
volver a conectar (los tokens emitidos quedan amarrados a la URL anterior).

## Darlo de alta en claude.ai

Requiere un plan de claude.ai que admita conectores personalizados.

1. claude.ai → **Configuración → Conectores → Agregar conector personalizado**.
2. Nombre: `MainTrack operador`. URL: la de arriba. No llene «Client ID» ni
   «Client secret» (en opciones avanzadas): claude.ai se registra solo.
3. **Conectar.** Se abre una ventana de MainTrack:
   - Si no hay sesión, pide iniciar sesión y regresa sola a la autorización.
   - Entre con la cuenta de **operador de la plataforma**. Con cualquier otra
     cuenta la pantalla lo dice y no ofrece el botón.
   - Revise lo que puede y no puede hacer el agente y oprima **Permitir**.
4. En una conversación, active el conector en el menú de herramientas y
   pregunte, por ejemplo: «¿Qué clientes tienen adopción baja y cuándo fue su
   última actividad?».

### Desconectarlo

- Quitar el conector en claude.ai, o
- En MainTrack: **Configuración → Seguridad → Cerrar sesión en todos los
  dispositivos**. Eso invalida también los tokens del agente (responde 401 y
  claude.ai pide volver a autorizar).
- Quitarle a la cuenta el rol de operador (`npm run super-admin -- --correo … --retirar`)
  corta el acceso en la siguiente llamada, sin esperar a que venza el token.

## Cómo está armado

| Pieza | Dónde |
|---|---|
| Endpoint MCP (Streamable HTTP, sin sesión, respuestas JSON) | `app/api/mcp/route.ts` |
| Protocolo JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call` | `lib/mcp/protocolo.ts` |
| Herramientas | `lib/mcp/herramientas.ts` |
| Cliente de base de datos de solo lectura | `lib/mcp/lectura.ts` |
| OAuth 2.1: registro dinámico, PKCE, tokens, renovación | `lib/mcp/oauth.ts` |
| Metadatos (RFC 9728 y RFC 8414) | `app/.well-known/…` |
| Pantalla de autorización | `app/oauth/autorizar/page.tsx` + `app/api/oauth/autorizar` |
| Prueba de punta a punta | `scripts/prueba-mcp.ts` |

### Las garantías, y dónde se cumplen

- **Solo lectura.** Las herramientas reciben `lectura`, un cliente de Prisma
  que truena ante cualquier operación que no sea `find*`, `count`,
  `aggregate` o `groupBy`, y que no expone SQL crudo ni transacciones. La
  prueba revisa además que `herramientas.ts` no importe `prisma`. Lo único que
  escribe el servidor es la bitácora y sus propias tablas de OAuth.
- **Solo el operador.** Se revisa al autorizar y **otra vez en cada llamada**
  contra la base (`isSuperAdmin`, cuenta activa, sesiones no revocadas).
- **Solo agregados.** Conteos, fechas y sumas por empresa. Ninguna
  herramienta devuelve descripciones de fallas, activos ni nombres o correos
  de la gente de los clientes.
- **Bitácora.** Cada `tools/call` —también las rechazadas y las que piden una
  herramienta que no existe— deja un renglón `MCP_ACCESS` con herramienta,
  parámetros, resultado, cliente OAuth y usuario, en la organización del
  operador. Se filtra en Configuración → Auditoría → «Agentes de IA (MCP)».
  Si el renglón no se puede escribir, el dato no se entrega.
- **Tokens.** Opacos, guardados por su huella SHA-256. Acceso: 1 hora.
  Renovación: 30 días, rotativa; reusar una ya canjeada revoca toda la
  familia. Códigos de autorización: 5 minutos, un solo uso, PKCE S256
  obligatorio.
- **Registro dinámico acotado.** Solo se aceptan direcciones de regreso de
  Claude (`claude.ai` y `claude.com`) y hasta 30 registros por hora.
- **Cabeceras de seguridad.** Las de `next.config.ts` aplican igual a todas
  las rutas nuevas; la prueba lo verifica sobre `/api/mcp`.

## Herramientas y ejemplo de respuesta

Los ejemplos salen de la base de **desarrollo** (por eso las cifras de
empresas son de pruebas). Cada respuesta trae `criterios` —cómo se calculó— y
`loQueNoSeVe` —lo que la cifra no alcanza a medir—.

### resumen_plataforma

Parámetros opcionales: `desde`, `hasta` (AAAA-MM-DD; por omisión, los últimos
30 días) para las órdenes creadas.

```json
{
  "generadoEl": "2026-09-27T18:21:07.400Z",
  "zonaHoraria": "America/Monterrey",
  "organizaciones": {
    "activas": 3941,
    "porEstado": {
      "ACTIVE": 3940,
      "TRIAL": 1
    },
    "nuevasEsteMes": 3940,
    "mes": "2026-09",
    "empresasDemostrativasExcluidas": 10
  },
  "usuariosActivos": {
    "ultimos7Dias": 364,
    "ultimos30Dias": 742,
    "criterio": "Persona del cliente que dejó un registro en la bitácora o inició sesión en la ventana. No cuenta al operador."
  },
  "ordenesCreadas": {
    "periodo": {
      "desde": "2026-08-29",
      "hasta": "2026-09-27",
      "dias": 30
    },
    "total": 7604,
    "empresasQueCrearonOrdenes": 2829
  },
  "criterios": {
    "activas": "Estado ACTIVE (pagando) o TRIAL (en prueba). No incluye SUSPENDED ni CANCELLED.",
    "demostrativas": "La empresa demostrativa no entra en ninguna cifra de este resumen."
  },
  "loQueNoSeVe": [
    "Quien solo consulta pantallas con una sesión abierta de días anteriores no deja huella y no cuenta como activo.",
    "Las órdenes incluyen las que creó el operador durante una implementación."
  ]
}
```

### listar_clientes

Parámetros: `estado` (ACTIVE, TRIAL, SUSPENDED, CANCELLED), `incluir_demo`
(falso), `orden` (ultima_actividad, alta, nombre), `limite` (1–200, 50).

```json
{
  "total": 3941,
  "mostradas": 200,
  "clientes": [
    {
      "organizacion_id": "cmuk59vv60001xnon8y1kdako",
      "nombre": "Cliente mcp-1790533262935",
      "fechaAlta": "2026-09-27T18:21:02.995Z",
      "plan": "Professional",
      "complementos": [],
      "estado": "TRIAL",
      "pruebaVence": null,
      "operandoDesde": null,
      "ultimaActividad": "2026-09-27T18:21:07.050Z",
      "usuarios": {
        "activos": 1,
        "conActividad30Dias": 1
      },
      "modulosEnUso": [
        "Funciones de IA"
      ],
      "nivelAdopcion": "EN_ARRANQUE",
      "movimientosDelOperador30Dias": 0
    },
    {
      "organizacion_id": "cmuk4am5h0000xnaowsnm0zbi",
      "nombre": "Ciclo",
      "fechaAlta": "2026-09-27T17:53:37.446Z",
      "plan": "Professional",
      "complementos": [],
      "estado": "ACTIVE",
      "operandoDesde": null,
      "ultimaActividad": "2026-09-27T17:53:37.591Z",
      "usuarios": {
        "activos": 1,
        "conActividad30Dias": 1
      },
      "modulosEnUso": [
        "Órdenes de trabajo",
        "Preventivo (órdenes generadas por planes)",
        "Alta de activos",
        "Almacén (movimientos)"
      ],
      "nivelAdopcion": "MEDIA",
      "movimientosDelOperador30Dias": 0
    }
  ],
  "criterios": {
    "moduloEnUso": "Se crearon registros de ese módulo en los últimos 30 días.",
    "nivelAdopcion": {
      "EN_ARRANQUE": "Cuenta de menos de 14 días con poca actividad: todavía no se puede juzgar.",
      "SIN_USO": "Ningún módulo con actividad en 30 días.",
      "BAJA": "1 o 2 módulos en uso.",
      "MEDIA": "3 o 4 módulos en uso.",
      "ALTA": "5 o más módulos en uso."
    },
    "ultimaActividad": "Lo más reciente entre la bitácora y el último inicio de sesión de la gente del cliente. No cuenta al operador.",
    "conActividad30Dias": "Persona del cliente que dejó un registro en la bitácora o inició sesión en la ventana. No cuenta al operador."
  },
  "loQueNoSeVe": [
    "Un módulo en uso puede serlo por trabajo del operador durante la implementación: compare con movimientosDelOperador30Dias.",
    "Lo que entra por la API de integración o por el formulario público del QR cuenta como actividad del módulo, aunque nadie del cliente haya entrado."
  ]
}
```

### detalle_cliente

Parámetro: `organizacion_id` (el de `listar_clientes`).

```json
{
  "organizacion_id": "cmuk59vv60001xnon8y1kdako",
  "nombre": "Cliente mcp-1790533262935",
  "giro": null,
  "tipoInstalacion": null,
  "plan": "Professional",
  "complementos": [],
  "estado": "TRIAL",
  "pruebaVence": null,
  "fechaAlta": "2026-09-27T18:21:02.995Z",
  "operandoDesde": null,
  "usuariosActivosPorRol": {
    "OWNER": 1
  },
  "adopcion": {
    "nivel": "EN_ARRANQUE",
    "modulosEnUso": 1,
    "modulos": [
      {
        "modulo": "Órdenes de trabajo",
        "clave": "ordenes",
        "enUso": false,
        "registros30Dias": 0,
        "registros90Dias": 0,
        "registrosTotales": 0,
        "ultimoRegistro": null
      },
      {
        "modulo": "Preventivo (órdenes generadas por planes)",
        "clave": "preventivo",
        "enUso": false,
        "registros30Dias": 0,
        "registros90Dias": 0,
        "registrosTotales": 0,
        "ultimoRegistro": null
      },
      {
        "modulo": "Solicitudes de trabajo",
        "clave": "solicitudes",
        "enUso": false,
        "registros30Dias": 0,
        "registros90Dias": 0,
        "registrosTotales": 0,
        "ultimoRegistro": null
      },
      {
        "…": "(13 módulos en total)"
      }
    ]
  },
  "tendencia": {
    "direccion": "SIN_BASE",
    "movimientosUltimas4Semanas": 3,
    "movimientos4SemanasPrevias": 0,
    "semanas": [
      {
        "semanaQueTermina": "2026-09-13",
        "movimientos": 0,
        "personasActivas": 0,
        "ordenesCreadas": 0
      },
      {
        "semanaQueTermina": "2026-09-20",
        "movimientos": 0,
        "personasActivas": 0,
        "ordenesCreadas": 0
      },
      {
        "semanaQueTermina": "2026-09-27",
        "movimientos": 3,
        "personasActivas": 1,
        "ordenesCreadas": 0
      },
      {
        "…": "(12 semanas en total)"
      }
    ]
  },
  "movimientosDelOperador30Dias": 0,
  "criterios": {
    "enUso": "Registros creados en los últimos 30 días.",
    "nivel": {
      "EN_ARRANQUE": "Cuenta de menos de 14 días con poca actividad: todavía no se puede juzgar.",
      "SIN_USO": "Ningún módulo con actividad en 30 días.",
      "BAJA": "1 o 2 módulos en uso.",
      "MEDIA": "3 o 4 módulos en uso.",
      "ALTA": "5 o más módulos en uso."
    },
    "movimientos": "Registros en la bitácora hechos por gente del cliente (no por el operador).",
    "direccion": "Últimas 4 semanas contra las 4 anteriores: SUBE (+20 %), BAJA (−20 %), ESTABLE, SIN_BASE (no había actividad antes: no hay contra qué comparar) o SIN_ACTIVIDAD."
  },
  "loQueNoSeVe": [
    "No se incluye el contenido de ningún registro: ni descripciones, ni equipos, ni personas.",
    "Consultar pantallas no deja huella: una cuenta que solo mira reportes se ve con poca actividad.",
    "Los registros por módulo incluyen los que creó el operador durante la implementación."
  ]
}
```

### consumo_ia

Parámetros: `desde`, `hasta` (obligatorios, rango máximo 366 días),
`organizacion_id` (opcional), `limite` (1–200, 50).

La voz se registra en caracteres y el dictado en segundos de audio en la misma
columna que los tokens; aquí se reportan aparte y no se suman como tokens.

```json
{
  "periodo": {
    "desde": "2026-01-01",
    "hasta": "2026-09-27",
    "dias": 270,
    "zonaHoraria": "America/Monterrey"
  },
  "totales": {
    "costoUsd": 0.102,
    "tokens": 1200,
    "llamadas": 3,
    "fallidas": 1,
    "empresas": 1
  },
  "porFuncion": [
    {
      "funcion": "VOZ",
      "nombre": "Lectura en voz alta",
      "llamadas": 1,
      "costoUsd": 0.08,
      "tokens": 0
    },
    {
      "funcion": "DICTADO",
      "nombre": "Dictado del técnico",
      "llamadas": 1,
      "costoUsd": 0.012,
      "tokens": 0
    },
    {
      "funcion": "DIAGNOSTICO",
      "nombre": "Diagnóstico semanal",
      "llamadas": 1,
      "costoUsd": 0.01,
      "tokens": 1200
    }
  ],
  "mostradas": 1,
  "organizaciones": [
    {
      "organizacion_id": "cmuk59vv60001xnon8y1kdako",
      "nombre": "Cliente mcp-1790533262935",
      "costoUsd": 0.102,
      "tokens": 1200,
      "llamadas": 3,
      "fallidas": 1,
      "porFuncion": [
        {
          "funcion": "VOZ",
          "nombre": "Lectura en voz alta",
          "llamadas": 1,
          "fallidas": 0,
          "operaciones": 0,
          "costoUsd": 0.08,
          "tokens": {
            "entrada": 0,
            "salida": 0,
            "cacheLeido": 0,
            "cacheEscrito": 0
          },
          "caracteresDeVoz": 5000
        },
        {
          "funcion": "DICTADO",
          "nombre": "Dictado del técnico",
          "llamadas": 1,
          "fallidas": 1,
          "operaciones": 1,
          "costoUsd": 0.012,
          "tokens": {
            "entrada": 0,
            "salida": 0,
            "cacheLeido": 0,
            "cacheEscrito": 0
          },
          "segundosDeAudio": 45
        },
        {
          "funcion": "DIAGNOSTICO",
          "nombre": "Diagnóstico semanal",
          "llamadas": 1,
          "fallidas": 0,
          "operaciones": 1,
          "costoUsd": 0.01,
          "tokens": {
            "entrada": 1000,
            "salida": 200,
            "cacheLeido": 0,
            "cacheEscrito": 0
          }
        }
      ]
    }
  ],
  "criterios": {
    "costoUsd": "Costo real ante los proveedores (Anthropic y Google), en dólares, tal como se registró en cada llamada.",
    "tokens": "Entrada + salida + caché leído + caché escrito, solo de funciones de modelo de lenguaje.",
    "unidades": "La voz se mide en caracteres sintetizados y el dictado en segundos de audio; van aparte y no se suman a los tokens.",
    "operaciones": "Lo que se descuenta de la bolsa del cliente; no es lo mismo que el costo."
  },
  "loQueNoSeVe": [
    "Las llamadas fallidas también cuestan y están incluidas en el costo.",
    "El consumo del operador trabajando dentro de una empresa cliente se registra a nombre de esa empresa."
  ]
}
```

### buscar_documentacion

Parámetros: `pregunta` (3–500 caracteres), `limite` (1–5, 3). Busca por
palabras, sin modelo, en las 58 fichas de `lib/ayuda.ts` y devuelve las
fichas completas.

```json
{
  "terminosBuscados": [
    "registro",
    "lectura",
    "medidor"
  ],
  "fichasEnCatalogo": 58,
  "resultados": [
    {
      "pantalla": "Medidores",
      "ruta": "/meters",
      "relevancia": 46,
      "contenido": "# Medidores (/meters)\n\nLas lecturas de horas, kilómetros o ciclos que disparan mantenimiento por uso.\n\n## Qué se puede hacer\n- Capturar lecturas, con fecha pasada si hace falta\n- Registrar el reinicio o la sustitución de un medidor\n- Corregir o anular una lectura mal capturada (supervisor en adelante)\n- Configurar el tipo de medidor y su uso máximo por día\n\n## De dónde viene y a dónde va\n- Un plan por medidor no dispara por calendario sino cuando la lectura alcanza el intervalo.\n- Un horómetro que suma más horas que las transcurridas en el reloj es físicamente imposible: se bloquea y no se ace\n…"
    }
  ],
  "fuente": "Fichas de ayuda de las pantallas de MainTrack (lib/ayuda.ts): el mismo texto que ve el cliente en el panel de ayuda."
}
```

## Probarlo

```bash
npx tsx scripts/prueba-mcp.ts
```

Recorre el flujo OAuth completo por HTTP (registro, autorización con usuario
operador y no operador, canje con PKCE, renovación, revocación), llama cada
herramienta, intenta escribir por todas las vías y revisa la bitácora.
