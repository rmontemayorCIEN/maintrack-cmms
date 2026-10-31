# Seguridad de la información — MainTrack

Evidencia técnica para ISO/IEC 27001:2022 (Anexo A). No es el sistema de gestión
completo (faltan alcance, política, riesgos, Declaración de Aplicabilidad,
auditoría interna y revisión por la dirección): es lo que ya opera y cómo se
comprueba. Plantilla: la de Agente 360. Archivo iniciado el 30 oct 2026.

| Control | Qué hay | Dónde / cómo se comprueba |
|---|---|---|
| 8.8 Vulnerabilidades técnicas | `npm audit` de producción en las pruebas de GitHub; altas y críticas detienen, salvo excepción con fecha. 29 oct 2026: Next.js 15.5.28 y Prisma 6.19.3. 30 oct 2026: zod 3 → 4 (agotamiento de memoria al validar colecciones grandes); se cerró su excepción, que vencía el 30 nov 2026, y el guardián pasa sin ninguna | `scripts/revisar-dependencias.mjs`, `seguridad/excepciones-dependencias.json`, `.github/workflows/pruebas.yml` |
| 5.15, 8.2, 8.3 Administración desde la Torre de Control | `GET /api/torre/admin/*` contesta solo a peticiones firmadas por la Torre (HMAC-SHA256, secreto `cmms-torre-admin-secreto` distinto del token de salud, 60 s, para esta app, ruta y cuerpo); lo demás es 404. Ejecuta las MISMAS herramientas de solo lectura del servidor MCP del operador (`listar_clientes`, `detalle_cliente`, `consumo_ia`) y el estado de cuenta: sin personas, activos ni descripciones. Como en el MCP, si el acceso no queda en la bitácora (`TORRE_ACCESS`, en la organización del operador, a nombre de quien firmó), el dato no sale | `lib/torre/administracion.ts` (copia igual de la fuente en la Torre), `lib/torre/cuentas.ts`, `scripts/prueba-torre-admin.ts` |

## Pendientes conocidos
- **Segundo factor:** MainTrack no tiene segundo factor, tampoco para el operador de la plataforma (`isSuperAdmin`), que entra a todas las empresas (ISO 27001, 8.5).
- **Bitácora del operador:** responder soporte, el seguimiento de prospectos y salir de «entrar como cliente» no quedan anotados.
- **Errores de entrada:** varias rutas del operador (`organizations/[id]`, `switch`, `billing/*`, `plan-requests`) usan `schema.parse` sin atrapar el error: un dato inválido responde 500 en lugar de 422, y `PATCH organizations/[id]` acepta un cuerpo vacío.
- Documentar aquí los controles que ya operan (acceso por organización y rol, autenticación, bitácora, cabeceras del navegador, respaldos, alertas, guardián de secretos) con su lugar en el código y cómo se comprueban.
