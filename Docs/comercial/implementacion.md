# Contratación e implementación

Precios, prueba, cobro y cambios de plan: `generados/planes-y-precios.md` (sale de `lib/comercial.ts` y `lib/planes.ts`). Documentos a aceptar: `/legal` (borradores para revisión profesional).

## Contratación: cómo funciona hoy

| Paso | Dónde | Qué pasa |
|---|---|---|
| Elegir plan | Sitio › Planes › «Empezar», o `/contratar` | Ve precio, periodicidad, límites y el complemento de IA por separado |
| Datos | `/contratar` | Empresa, giro, tipo de instalación, rango de equipos, responsable principal |
| Modalidad inicial | `/contratar` | Vacía, configuración recomendada o datos de demostración temporales |
| Documentos | `/contratar` | Acepta contrato, términos y aviso de privacidad; se guarda la versión y la fecha |
| Resultado con el alta **cerrada** (producción hoy) | — | «Solicitud recibida · validación pendiente». Queda en Empresas cliente › Prospectos. No se crea nada ni se cobra |
| Resultado con el alta **abierta** (`ALLOW_PUBLIC_SIGNUP=true`) | — | Se crea la empresa en prueba de 30 días, con su responsable y sesión, y sigue en la puesta en marcha |

**El cobro no está automatizado.** No hay pago en línea ni se simula: la primera nota de cobro se emite al terminar la prueba, desde Empresas cliente › Cobranza, y el pago se registra al confirmarse. La factura fiscal (CFDI) se emite fuera de MainTrack.

**Con el alta cerrada**, quien valida la solicitud da de alta la empresa en Empresas cliente (con los mismos datos, el plan y la modalidad elegidos) y marca el prospecto como «Ganada».

## Ruta de alta

| # | Paso | Responsable | Entregable |
|---|---|---|---|
| 1 | Confirmación comercial | MainTrack | Plan, complemento y fecha de arranque acordados |
| 2 | Contrato o aceptación | Cliente (quien firma) | Documentos aceptados (en `/contratar` o firmados aparte) |
| 3 | Selección de plan | Cliente con MainTrack | Plan registrado en la cuenta |
| 4 | Creación de la empresa | MainTrack (o el cliente en `/contratar` con alta abierta) | Empresa en prueba, con su modalidad inicial |
| 5 | Responsable principal | Cliente | Usuario Propietario activo |
| 6 | Tipo de instalación | Cliente | Catálogos del giro cargados |
| 7 | Modalidad inicial | Cliente con MainTrack | Vacía, recomendada o demo temporal (la demo se quita antes de operar) |
| 8 | Carga de información | Administrador del cliente | Equipos, ubicaciones, refacciones, planes y usuarios importados (18 plantillas en Importar) |
| 9 | Capacitación | MainTrack | Una sesión por rol (ver guías rápidas en `incorporacion.md`) |
| 10 | Validación para operar | Administrador del cliente | Puesta en marcha al 100 % y «Comenzar a operar» declarado |
| 11 | Acompañamiento inicial | MainTrack | Revisión semanal de calidad de datos y dudas durante el primer mes |
| 12 | Operación normal | Cliente | Soporte por la sección Soporte, según el SLA |

La implementación **no es automática**: la puesta en marcha guía, pero la información la aporta el cliente y la revisa MainTrack.

## Qué le toca a cada quien

- **MainTrack:** crear la empresa, cargar la configuración recomendada, validar las importaciones, capacitar, acompañar el primer mes, atender soporte.
- **Cliente (dirección):** nombrar al administrador y a los responsables, aprobar el plan, dar prioridad al arranque.
- **Administrador del cliente:** reunir y cargar la información, dar de alta usuarios y roles, cerrar la puesta en marcha.
- **Usuarios operativos:** reportar fallas, ejecutar y cerrar órdenes, registrar lecturas y consumos desde el primer día.
