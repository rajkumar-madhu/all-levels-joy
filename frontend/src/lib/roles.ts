// Mirrors policies/itsm/authz.rego so the UI only offers actions the API will allow.
export const REQUEST_UPDATE_ROLES = ["service_desk", "fulfiller", "manager", "admin"];
export const CHANGE_CREATE_ROLES = ["fulfiller", "change_manager", "manager", "admin"];
export const CHANGE_UPDATE_ROLES = ["change_manager", "admin"];

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}
