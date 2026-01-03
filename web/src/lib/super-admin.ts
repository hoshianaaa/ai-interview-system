export const SUPER_ADMIN_ORG_ID = process.env.SUPER_ADMIN_ORG_ID ?? "";

export function isSuperAdminOrgId(orgId: string | null | undefined): boolean {
  return Boolean(orgId && SUPER_ADMIN_ORG_ID && orgId === SUPER_ADMIN_ORG_ID);
}
