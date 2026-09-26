# Material comercial de MainTrack

| Documento | Para qué | Cómo se mantiene |
|---|---|---|
| `generados/propuesta-de-valor.md` | Descripción, cinco problemas, diferenciadores, módulos, qué no es | Generado de `lib/comercial.ts` |
| `generados/planes-y-precios.md` | Planes, precios, límites, complemento, condiciones y comparación | Generado de `lib/planes.ts` y `lib/comercial.ts` |
| `generados/presentacion.md` | Las diapositivas de la presentación al cliente, en documento | Generado de `lib/demo-presentacion.ts` |
| `generados/historias-demo.md` | Las cinco historias, el recorrido y cómo restaurar | Generado de `lib/demo-guia.ts` |
| `generados/integraciones.md` | La respuesta cuando el cliente dice el nombre de su ERP: postura, lo que ya hay, permisos, eventos, carga por archivo, qué esperar de cada ERP y qué preguntarle a su área de sistemas | Generado de `lib/comercial-integraciones.ts`, `lib/integraciones/alcances.ts`, el catálogo de avisos y `lib/importacion.ts` |
| `generados/preguntas-frecuentes.md` | Preguntas frecuentes (las mismas del sitio) | Generado |
| `generados/sla-resumen.md` y `generados/legal/*.md` | Borradores legales y de servicio (10) | Generado de `lib/legal.ts` |
| `guion-demostracion.md` | Guion de 20 a 30 minutos, objeciones y cierre | A mano |
| `implementacion.md` | Contratación, ruta de alta y responsables | A mano |
| `incorporacion.md` | Requisitos, plantillas, responsables, agenda, guías por rol, checklist | A mano |

Los generados **no se editan**: se cambia la fuente y se corre `npx tsx scripts/generar-documentos-comerciales.ts`. `npm run actualizar` avisa si quedaron desactualizados.

**Los documentos legales son borradores** para revisión de un abogado y de un especialista en protección de datos; faltan razón social, RFC, domicilio, medio de contacto para derechos de privacidad, ley aplicable y límite de responsabilidad. No se entregan como definitivos.
