/** UI hint only: all privileged operations are independently revalidated. */
export function isSuperadminRole(roles: readonly string[] | null | undefined): boolean {
  return roles?.includes("superadmin") === true;
}
