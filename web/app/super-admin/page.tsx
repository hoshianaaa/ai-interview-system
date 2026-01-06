import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId, SUPER_ADMIN_ORG_ID } from "@/lib/super-admin";
import type { OrgPlan } from "@/lib/billing";
import OrganizationGate from "../admin/OrganizationGate";
import SuperAdminDashboard from "./SuperAdminDashboard";
import SuperAdminGate from "./SuperAdminGate";

type OrgSubscriptionRow = {
  orgId: string;
  orgName: string;
  planId: OrgPlan | null;
  billingAnchorAt: string | null;
  cycleStartedAt: string | null;
  cycleEndsAt: string | null;
  usedSec: number;
  reservedSec: number;
  overageApproved: boolean;
  updatedAt: string | null;
  hasSubscription: boolean;
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

  const subscriptions = await prisma.orgSubscription.findMany({
    orderBy: { orgId: "asc" }
  });
  const subscriptionsByOrg = new Map(
    subscriptions.map((row) => [row.orgId, row])
  );

  let orgs: { id: string; name: string }[] = [];
  let orgsLoadError: string | null = null;
  try {
    orgs = await listAllOrganizations();
  } catch {
    orgsLoadError = "ORG_LIST_FAILED";
  }

  const rows: OrgSubscriptionRow[] = orgs.map((org) => {
    const subscription = subscriptionsByOrg.get(org.id);
    return {
      orgId: org.id,
      orgName: org.name,
      planId: subscription?.plan ?? null,
      billingAnchorAt: subscription?.billingAnchorAt.toISOString() ?? null,
      cycleStartedAt: subscription?.cycleStartedAt.toISOString() ?? null,
      cycleEndsAt: subscription?.cycleEndsAt.toISOString() ?? null,
      usedSec: subscription?.usedSec ?? 0,
      reservedSec: subscription?.reservedSec ?? 0,
      overageApproved: subscription?.overageApproved ?? false,
      updatedAt: subscription?.updatedAt.toISOString() ?? null,
      hasSubscription: Boolean(subscription)
    };
  });

  const orgIdSet = new Set(orgs.map((org) => org.id));
  for (const subscription of subscriptions) {
    if (orgIdSet.has(subscription.orgId)) continue;
    rows.push({
      orgId: subscription.orgId,
      orgName: "不明な組織",
      planId: subscription.plan,
      billingAnchorAt: subscription.billingAnchorAt.toISOString(),
      cycleStartedAt: subscription.cycleStartedAt.toISOString(),
      cycleEndsAt: subscription.cycleEndsAt.toISOString(),
      usedSec: subscription.usedSec,
      reservedSec: subscription.reservedSec,
      overageApproved: subscription.overageApproved,
      updatedAt: subscription.updatedAt.toISOString(),
      hasSubscription: true
    });
  }

  return (
    <SuperAdminDashboard
      initialRows={rows}
      orgsLoadError={orgsLoadError}
    />
  );
}
