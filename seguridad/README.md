# Seguridad de la información — MainTrack

Evidencia técnica para ISO/IEC 27001:2022 (Anexo A). No es el sistema de gestión
completo (faltan alcance, política, riesgos, Declaración de Aplicabilidad,
auditoría interna y revisión por la dirección): es lo que ya opera y cómo se
comprueba. Plantilla: la de Agente 360. Archivo iniciado el 30 oct 2026.

| Control | Qué hay | Dónde / cómo se comprueba |
|---|---|---|
| 8.8 Vulnerabilidades técnicas | `npm audit` de producción en las pruebas de GitHub; altas y críticas detienen, salvo excepción con fecha. 29 oct 2026: Next.js 15.5.28 y Prisma 6.19.3. 30 oct 2026: zod 3 → 4 (agotamiento de memoria al validar colecciones grandes); se cerró su excepción, que vencía el 30 nov 2026, y el guardián pasa sin ninguna | `scripts/revisar-dependencias.mjs`, `seguridad/excepciones-dependencias.json`, `.github/workflows/pruebas.yml` |
| 5.15, 8.2, 8.3 Administración desde la Torre de Control | `GET /api/torre/admin/*` contesta solo a peticiones firmadas por la Torre (HMAC-SHA256, secreto `cmms-torre-admin-secreto` distinto del token de salud, 60 s, para esta app, ruta y cuerpo); lo demás es 404. Ejecuta las MISMAS herramientas de solo lectura del servidor MCP del operador (`listar_clientes`, `detalle_cliente`, `consumo_ia`) y el estado de cuenta: sin personas, activos ni descripciones. Como en el MCP, si el acceso no queda en la bitácora (`TORRE_ACCESS`, en la organización del operador, a nombre de quien firmó), el dato no sale | `lib/torre/administracion.ts` (copia igual de la fuente en la Torre), `lib/torre/cuentas.ts`, `scripts/prueba-torre-admin.ts` |
| 8.15 Bitácora del operador | Además de entrar a una empresa cliente, quedan anotados: salir de ella (`CLIENT_LEFT`), responder soporte (`SUPPORT_REPLIED`) y el seguimiento de prospectos (`PROSPECT_UPDATED`), en el módulo «Operación de la plataforma» | `app/api/admin/*`, `lib/bitacora.ts`, `scripts/prueba-bitacora.ts` |
| 8.28 Entradas del operador | `leerCuerpo` (lib/api.ts): un cuerpo que no es JSON o no pasa el esquema es 422 con su motivo, nunca 500; `PATCH organizations/[id]` rechaza un cuerpo sin cambios | `lib/api.ts › leerCuerpo`, `scripts/prueba-leer-cuerpo.ts` |
| 8.5 Autenticación del operador | Segundo factor TOTP (el mismo código de la Torre, probado contra los vectores del RFC 6238) OBLIGATORIO para el operador de la plataforma: sin él, `requireSuperAdmin`, el servidor MCP y la impresión de cargos ajenos no lo dejan operar, y sus pantallas dicen dónde activarlo. Secreto cifrado con AES-256-GCM (llave derivada de AUTH_SECRET por HKDF; rotar AUTH_SECRET obliga a darlo de alta otra vez), el mismo código no sirve dos veces, 10 códigos de respaldo de un solo uso guardados como huellas, desafío de 5 min firmado con otra llave (no sirve como sesión) y los códigos fallidos cuentan en el freno de intentos | `lib/totp.ts`, `lib/segundo-factor.ts`, `app/api/auth/segundo-factor`, `app/api/account/segundo-factor`, `scripts/prueba-segundo-factor.ts` |

## Pendientes conocidos
- **Segundo factor para las demás cuentas:** hoy solo el operador lo tiene (y se le exige). Ofrecerlo a los clientes, y que un propietario lo pueda exigir a su empresa, queda para después.
- Documentar aquí los controles que ya operan (acceso por organización y rol, autenticación, bitácora, cabeceras del navegador, respaldos, alertas, guardián de secretos) con su lugar en el código y cómo se comprueban.
