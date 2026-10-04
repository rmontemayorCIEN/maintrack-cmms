/** Control de acceso por rol. Cada permiso mapea a los roles autorizados. */

export type Permission =
  | "asset:write"
  | "plan:write"
  | "workorder:write"
  | "workorder:close"
  | "workorder:execute"
  | "workorder:reopen"
  | "request:create"
  | "request:review"
  | "inventory:write"
  | "requisition:create"
  | "purchase:request"
  | "purchase:authorize"
  | "purchase:receive"
  | "predictive:write"
  | "vigencia:write"
  | "settings:write"
  | "user:manage"
  | "billing:manage"
  | "data:export";

const MATRIX: Record<Permission, string[]> = {
  "asset:write": ["OWNER", "ADMIN", "SUPERVISOR"],
  "plan:write": ["OWNER", "ADMIN", "SUPERVISOR"],
  "workorder:write": ["OWNER", "ADMIN", "SUPERVISOR"],
  // Completar (cierre tecnico) lo hace quien ejecuta; cerrar (cierre
  // administrativo) lo valida el supervisor; reabrir una orden ya cerrada es
  // una excepcion y la gestiona la administracion.
  "workorder:close": ["OWNER", "ADMIN", "SUPERVISOR"],
  "workorder:execute": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  "workorder:reopen": ["OWNER", "ADMIN"],
  "request:create": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER"],
  "request:review": ["OWNER", "ADMIN", "SUPERVISOR"],
  "inventory:write": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"],
  // Pedir material lo puede hacer cualquiera que trabaje en la instalacion,
  // incluido quien solo reporta: pedir no mueve existencia. Surtir sigue
  // requiriendo inventory:write, que es quien si toca el saldo.
  "requisition:create": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER"],
  // Solicitar una compra la pide quien descubre que no hay: el almacen o el
  // supervisor. Autorizarla es otra cosa y por eso es otro permiso: quien
  // pide no puede firmarse a si mismo.
  "purchase:request": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS"],
  "purchase:authorize": ["OWNER", "ADMIN"],
  "purchase:receive": ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS"],
  "predictive:write": ["OWNER", "ADMIN", "SUPERVISOR"],
  // Una garantia, una poliza o un contrato los captura quien los tiene en la
  // mano —administracion, o supervision cuando llega el equipo nuevo—, no
  // quien ejecuta el trabajo. Verlas si es de todos los que ven la pantalla:
  // el tecnico necesita saber que el equipo esta cubierto antes de abrirlo.
  "vigencia:write": ["OWNER", "ADMIN", "SUPERVISOR"],
  "settings:write": ["OWNER", "ADMIN"],
  "user:manage": ["OWNER", "ADMIN"],
  "billing:manage": ["OWNER"],
  // Bajar la informacion completa en CSV no es una consulta mas: es llevarse el
  // padron de equipos, los costos y el inventario. Lo hace quien responde por
  // esos datos, no cualquiera con sesion.
  "data:export": ["OWNER", "ADMIN", "SUPERVISOR"],
};

export function can(role: string | undefined, permission: Permission) {
  if (!role) return false;
  return MATRIX[permission].includes(role);
}

export function assertCan(role: string | undefined, permission: Permission) {
  if (!can(role, permission)) throw new Error("FORBIDDEN");
}
