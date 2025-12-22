import AdminDashboard from "./admin/AdminDashboard";
import OrganizationGate from "./admin/OrganizationGate";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getProgressStatusLabel } from "@/lib/interview-status";

export default async function HomePage() {
  const { orgId } = await auth();
  if (!orgId) {
    return <OrganizationGate />;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const interviews = await prisma.interview.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: { application: { select: { candidateName: true } } }
  });
  const templates = await prisma.promptTemplate.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
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
    candidateName: row.application?.candidateName ?? null,
    prompt: row.interviewPrompt ?? null,
    notes: row.interviewNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    hasRecording: Boolean(row.r2ObjectKey)
  }));
  const templateData = templates.map((row) => ({
    templateId: row.templateId,
    name: row.name,
    body: row.body,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString()
  }));

  return <AdminDashboard interviews={data} promptTemplates={templateData} />;
}
