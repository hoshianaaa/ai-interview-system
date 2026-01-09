import AdminDashboard from "./admin/AdminDashboard";
import OrganizationGate from "./admin/OrganizationGate";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getProgressStatusLabel } from "@/lib/interview-status";
import { buildBillingSummary } from "@/lib/billing";
import { refreshOrgSubscription } from "@/lib/subscription";

export default async function HomePage() {
  const { orgId } = await auth();
  if (!orgId) {
    return <OrganizationGate />;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const interviews = await prisma.interview.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: {
      application: {
        select: {
          candidateName: true,
          candidateEmail: true,
          applicationNotes: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });
  const applications = await prisma.application.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
  });
  const templates = await prisma.promptTemplate.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
  });
  const settings = await prisma.orgSetting.findUnique({
    where: { orgId }
  });
  const subscription = await prisma.orgSubscription.findUnique({
    where: { orgId }
  });
  const now = new Date();
  const data = interviews.map((row) => ({
    interviewId: row.interviewId,
    applicationId: row.applicationId,
    url: `${baseUrl}/interview/${row.publicToken ?? row.interviewId}`,
    status: getProgressStatusLabel(
      { status: row.status, expiresAt: row.expiresAt, usedAt: row.usedAt },
      now
    ),
    decision: row.decision,
    round: row.round,
    applicationCandidateName: row.application?.candidateName ?? null,
    applicationEmail: row.application?.candidateEmail ?? null,
    applicationNotes: row.application?.applicationNotes ?? null,
    applicationCreatedAt: row.application?.createdAt
      ? row.application.createdAt.toISOString()
      : row.createdAt.toISOString(),
    applicationUpdatedAt: row.application?.updatedAt
      ? row.application.updatedAt.toISOString()
      : row.createdAt.toISOString(),
    prompt: row.interviewPrompt ?? null,
    durationSec: row.durationSec,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    hasRecording: Boolean(row.streamUid)
  }));
  const applicationData = applications.map((row) => ({
    applicationId: row.applicationId,
    candidateName: row.candidateName ?? null,
    candidateEmail: row.candidateEmail ?? null,
    notes: row.applicationNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));
  const templateData = templates.map((row) => ({
    templateId: row.templateId,
    name: row.name,
    body: row.body,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString()
  }));
  const defaultDurationMin = Math.min(
    10,
    Math.max(1, settings?.defaultDurationMin ?? 10)
  );
  const settingsData = {
    defaultDurationMin,
    defaultExpiresWeeks: settings?.defaultExpiresWeeks ?? 1,
    defaultExpiresDays: settings?.defaultExpiresDays ?? 0,
    defaultExpiresHours: settings?.defaultExpiresHours ?? 0
  };
  let billingData = null;
  if (subscription) {
    const current = await refreshOrgSubscription(prisma, subscription, now);
    if (current) {
      const summary = buildBillingSummary(current);
      billingData = {
        planId: summary.planId,
        monthlyPriceYen: summary.monthlyPriceYen,
        includedMinutes: summary.includedMinutes,
        overageRateYenPerMin: summary.overageRateYenPerMin,
        overageLimitMinutes: summary.overageLimitMinutes,
        cycleStartedAt: summary.cycleStartedAt.toISOString(),
        cycleEndsAt: summary.cycleEndsAt.toISOString(),
        usedSec: summary.usedSec,
        reservedSec: summary.reservedSec,
        remainingIncludedSec: summary.remainingIncludedSec,
        overageUsedSec: summary.overageUsedSec,
        overageChargeYen: summary.overageChargeYen,
        overageRemainingSec: summary.overageRemainingSec,
        overageApproved: summary.overageApproved,
        overageLocked: summary.overageLocked
      };
    }
  }

  return (
    <AdminDashboard
      interviews={data}
      applications={applicationData}
      promptTemplates={templateData}
      settings={settingsData}
      billing={billingData}
    />
  );
}
