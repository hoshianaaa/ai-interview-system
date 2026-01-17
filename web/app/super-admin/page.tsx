import { auth, clerkClient } from "@clerk/nextjs/server";
import type { OrgSubscription } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId, SUPER_ADMIN_ORG_ID } from "@/lib/super-admin";
import type { OrgPlan } from "@/lib/billing";
import { refreshOrgSubscription } from "@/lib/subscription";
import { getSystemMaxConcurrentInterviews } from "@/lib/system-settings";
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
  overageLimitMinutes: number | null;
  maxConcurrentInterviews: number | null;
  activeInterviewCount: number;
  overageApproved: boolean;
  renewOnCycleEnd: boolean;
  updatedAt: string | null;
  hasSubscription: boolean;
};

type PromptTemplateRow = {
  templateId: string;
  name: string;
  body: string;
  openingMessage: string | null;
  createdAt: string;
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

const getSuperAdminOrgName = async () => {
  if (!SUPER_ADMIN_ORG_ID) return null;
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: SUPER_ADMIN_ORG_ID
    });
    return org.name || null;
  } catch {
    return null;
  }
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
    const superAdminOrgName = await getSuperAdminOrgName();
    const message = superAdminOrgName
      ? `${superAdminOrgName}\u306e\u7d44\u7e54\u306b\u5207\u308a\u66ff\u3048\u3066\u304f\u3060\u3055\u3044\u3002`
      : "\u30b9\u30fc\u30d1\u30fc\u7ba1\u7406\u7528\u306e\u7d44\u7e54\u306b\u5207\u308a\u66ff\u3048\u3066\u304f\u3060\u3055\u3044\u3002";
    return (
      <SuperAdminGate
        message={message}
      />
    );
  }

  const templates = await prisma.promptTemplate.findMany({
    where: { orgId: SUPER_ADMIN_ORG_ID, isShared: true },
    orderBy: { createdAt: "desc" }
  });
  const templateData: PromptTemplateRow[] = templates.map((row) => ({
    templateId: row.templateId,
    name: row.name,
    body: row.body,
    openingMessage: row.openingMessage ?? null,
    createdAt: row.createdAt.toISOString()
  }));

  const subscriptions = await prisma.orgSubscription.findMany({
    orderBy: { orgId: "asc" }
  });
  const now = new Date();
  const refreshedSubscriptions = (
    await Promise.all(
      subscriptions.map((subscription) =>
        refreshOrgSubscription(prisma, subscription, now)
      )
    )
  ).filter((subscription): subscription is OrgSubscription => subscription !== null);
  const subscriptionsByOrg = new Map(
    refreshedSubscriptions.map((row) => [row.orgId, row])
  );

  const maxConcurrentInterviews = await getSystemMaxConcurrentInterviews(prisma);
  const activeInterviewCounts = await prisma.interview.groupBy({
    by: ["orgId"],
    _count: { _all: true },
    where: {
      orgId: { not: null },
      status: { in: ["used", "recording", "ending"] }
    }
  });
  const activeInterviewCountByOrg = new Map(
    activeInterviewCounts
      .filter((row) => Boolean(row.orgId))
      .map((row) => [row.orgId as string, row._count._all])
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
      overageLimitMinutes: subscription?.overageLimitMinutes ?? null,
      maxConcurrentInterviews: subscription?.maxConcurrentInterviews ?? null,
      activeInterviewCount: activeInterviewCountByOrg.get(org.id) ?? 0,
      overageApproved: subscription?.overageApproved ?? false,
      renewOnCycleEnd: subscription?.renewOnCycleEnd ?? false,
      updatedAt: subscription?.updatedAt.toISOString() ?? null,
      hasSubscription: Boolean(subscription)
    };
  });

  const orgIdSet = new Set(orgs.map((org) => org.id));
  for (const subscription of refreshedSubscriptions) {
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
      overageLimitMinutes: subscription.overageLimitMinutes ?? null,
      maxConcurrentInterviews: subscription.maxConcurrentInterviews ?? null,
      activeInterviewCount: activeInterviewCountByOrg.get(subscription.orgId) ?? 0,
      overageApproved: subscription.overageApproved,
      renewOnCycleEnd: subscription.renewOnCycleEnd,
      updatedAt: subscription.updatedAt.toISOString(),
      hasSubscription: true
    });
  }

  return (
    <SuperAdminDashboard
      initialRows={rows}
      orgsLoadError={orgsLoadError}
      systemSettings={{ maxConcurrentInterviews }}
      promptTemplates={templateData}
    />
  );
}
