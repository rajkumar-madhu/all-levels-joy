// Mirrors policies/itsm/authz.rego so the UI only offers actions the API will allow.
export const REQUEST_UPDATE_ROLES = ["service_desk", "fulfiller", "manager", "admin"];
export const CHANGE_CREATE_ROLES = ["fulfiller", "change_manager", "manager", "admin"];
export const CHANGE_UPDATE_ROLES = ["change_manager", "admin"];

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}
// problem.functions.ts requireProblemRole: who may declare and run a major incident bridge.
export const MAJOR_INCIDENT_ROLES = ["service_desk", "fulfiller", "manager", "admin", "change_manager"];
// policies/itsm/cmdb.rego: configuration items and catalogue routing.
export const CMDB_MANAGE_ROLES = ["cmdb_manager", "admin"];
export const CATALOG_MANAGE_ROLES = ["manager", "admin"];
