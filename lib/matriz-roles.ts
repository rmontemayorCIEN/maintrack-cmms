/**
 * Qué puede hacer cada rol, en lenguaje de negocio.
 *
 * Es la MISMA matriz que aplica el servidor —`lib/rbac.ts` la traduce a
 * permisos— pero escrita para leerse: la ve quien da de alta a una persona y
 * tiene que decidir con qué rol entra. Sin esto, elegir rol es adivinar.
 *
 * Este archivo no toca la base ni depende de nada del servidor: lo importa la
 * pantalla de Usuarios y también las pruebas.
 */
import { can, type Permission } from "./rbac";

export const ROLES_DEL_SISTEMA = [
  "OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER",
] as const;

export type RolDelSistema = (typeof ROLES_DEL_SISTEMA)[number];

/** Una fila de la referencia: lo que se hace, y con qué permiso se resuelve. */
export type AccionDeRol = {
  grupo: string;
  accion: string;
  permiso: Permission;
};

/**
 * Las acciones que vale la pena mostrar, agrupadas como las piensa una planta.
 *
 * No están todas las rutas del sistema: están las decisiones que cambian según
 * el rol. Consultar no aparece porque cualquiera con cuenta consulta lo de su
 * empresa; lo que se controla es escribir, autorizar y llevarse información.
 */
export const ACCIONES_POR_ROL: AccionDeRol[] = [
  { grupo: "Órdenes de trabajo", accion: "Crear y editar órdenes y sus actividades", permiso: "workorder:write" },
  { grupo: "Órdenes de trabajo", accion: "Ejecutar: iniciar, registrar horas, materiales y evidencias", permiso: "workorder:execute" },
  { grupo: "Órdenes de trabajo", accion: "Validar y cerrar una orden terminada", permiso: "workorder:close" },
  { grupo: "Órdenes de trabajo", accion: "Reabrir una orden ya cerrada", permiso: "workorder:reopen" },

  { grupo: "Activos y planes", accion: "Dar de alta y editar activos y medidores", permiso: "asset:write" },
  { grupo: "Activos y planes", accion: "Crear y editar planes de mantenimiento", permiso: "plan:write" },
  { grupo: "Activos y planes", accion: "Configurar el monitoreo predictivo", permiso: "predictive:write" },

  { grupo: "Solicitudes y QR", accion: "Levantar una solicitud", permiso: "request:create" },
  { grupo: "Solicitudes y QR", accion: "Revisar y convertir solicitudes en órdenes", permiso: "request:review" },
  { grupo: "Solicitudes y QR", accion: "Crear puntos de reporte QR y decidir qué muestran", permiso: "settings:write" },

  { grupo: "Almacén y compras", accion: "Pedir material con un vale", permiso: "requisition:create" },
  { grupo: "Almacén y compras", accion: "Surtir, devolver y ajustar existencias", permiso: "inventory:write" },
  { grupo: "Almacén y compras", accion: "Solicitar una compra", permiso: "purchase:request" },
  { grupo: "Almacén y compras", accion: "Autorizar una compra", permiso: "purchase:authorize" },
  { grupo: "Almacén y compras", accion: "Recibir material de una compra", permiso: "purchase:receive" },

  { grupo: "Información", accion: "Exportar información a CSV", permiso: "data:export" },

  { grupo: "Administración", accion: "Proveedores, catálogos y configuración de la empresa", permiso: "settings:write" },
  { grupo: "Administración", accion: "Dar de alta usuarios, cambiar roles y contraseñas", permiso: "user:manage" },
  { grupo: "Administración", accion: "Plan contratado y estado de cuenta", permiso: "billing:manage" },
];

/** Los roles que pueden una acción. Sale de `can()`, la misma que usa el servidor. */
export function rolesQuePueden(permiso: Permission): RolDelSistema[] {
  return ROLES_DEL_SISTEMA.filter((rol) => can(rol, permiso));
}

/**
 * Lo que una persona con este rol puede hacer, para explicarlo en una línea.
 *
 * Consulta no puede nada: es de solo lectura por construcción, y decirlo así
 * evita que alguien lo dé de alta esperando que capture.
 */
export function resumenDeRol(rol: string): string {
  const puede = ACCIONES_POR_ROL.filter((a) => can(rol, a.permiso));
  if (!puede.length) return "Solo consulta: ve la información de su empresa y no puede capturar ni modificar nada.";
  const grupos = [...new Set(puede.map((a) => a.grupo))];
  return `Puede ${puede.length} de ${ACCIONES_POR_ROL.length} acciones, en: ${grupos.join(", ").toLowerCase()}.`;
}
