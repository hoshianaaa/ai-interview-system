import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId, SUPER_ADMIN_ORG_ID } from "@/lib/super-admin";
import OrganizationGate from "../admin/OrganizationGate";
import SuperAdminDashboard from "./SuperAdminDashboard";
import SuperAdminGate from "./SuperAdminGate";

type OrgQuotaRow = {
  orgId: string;
  orgName: string;
  availableSec: number;
  updatedAt: string | null;
  hasQuota: boolean;
};

const listAllOrganizations = async () => {
  const client = await clerkClient();
  const limit = 100;
  let offset = 0;
  let results: { id: string; name: string }[] = [];

  while (true) {
    const page = await client.organizations.getOrganizationList({
      limit,
      offset
    });
    results = results.concat(
      page.data.map((org) => ({
        id: org.id,
        name: org.name
      }))
    );
    offset += page.data.length;
    if (page.data.length === 0 || offset >= page.totalCount) break;
  }

  return results;
};

export default async function SuperAdminPage() {
  const { orgId } = await auth();
  if (!orgId) {
    return <OrganizationGate />;
  }

  if (!SUPER_ADMIN_ORG_ID) {
    return (
      <SuperAdminGate message="SUPER_ADMIN_ORG_ID is not configured." />
    );
  }

  if (!isSuperAdminOrgId(orgId)) {
    return (
      <SuperAdminGate
        message={`Switch to the super admin org: ${SUPER_ADMIN_ORG_ID}.`}
      />
    );
  }

  const quotas = await prisma.orgQuota.findMany({ orderBy: { orgId: "asc" } });
  const quotasByOrg = new Map(quotas.map((row) => [row.orgId, row]));

  let orgs: { id: string; name: string }[] = [];
  let orgsLoadError: string | null = null;
  try {
    orgs = await listAllOrganizations();
  } catch {
    orgsLoadError = "ORG_LIST_FAILED";
  }

  const rows: OrgQuotaRow[] = orgs.map((org) => {
    const quota = quotasByOrg.get(org.id);
    return {
      orgId: org.id,
      orgName: org.name,
      availableSec: quota?.availableSec ?? 0,
      updatedAt: quota?.updatedAt.toISOString() ?? null,
      hasQuota: Boolean(quota)
    };
  });

  const orgIdSet = new Set(orgs.map((org) => org.id));
  for (const quota of quotas) {
    if (orgIdSet.has(quota.orgId)) continue;
    rows.push({
      orgId: quota.orgId,
      orgName: "不明な組織",
      availableSec: quota.availableSec,
      updatedAt: quota.updatedAt.toISOString(),
      hasQuota: true
    });
  }

  return (
    <SuperAdminDashboard
      initialRows={rows}
      orgsLoadError={orgsLoadError}
    />
  );
}
