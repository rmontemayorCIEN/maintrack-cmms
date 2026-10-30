# Seguridad de la información — MainTrack

Evidencia técnica para ISO/IEC 27001:2022 (Anexo A). No es el sistema de gestión
completo (faltan alcance, política, riesgos, Declaración de Aplicabilidad,
auditoría interna y revisión por la dirección): es lo que ya opera y cómo se
comprueba. Plantilla: la de Agente 360. Archivo iniciado el 30 oct 2026.

| Control | Qué hay | Dónde / cómo se comprueba |
|---|---|---|
| 8.8 Vulnerabilidades técnicas | `npm audit` de producción en las pruebas de GitHub; altas y críticas detienen, salvo excepción con fecha. 29 oct 2026: Next.js 15.5.28 y Prisma 6.19.3. 30 oct 2026: zod 3 → 4 (agotamiento de memoria al validar colecciones grandes); se cerró su excepción, que vencía el 30 nov 2026, y el guardián pasa sin ninguna | `scripts/revisar-dependencias.mjs`, `seguridad/excepciones-dependencias.json`, `.github/workflows/pruebas.yml` |

## Pendientes conocidos
- Documentar aquí los controles que ya operan (acceso por organización y rol, autenticación, bitácora, cabeceras del navegador, respaldos, alertas, guardián de secretos) con su lugar en el código y cómo se comprueban.
