import AdminDashboard from "./admin/AdminDashboard";
import OrganizationGate from "./admin/OrganizationGate";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const { orgId } = await auth();
  if (!orgId) {
    return <OrganizationGate />;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const interviews = await prisma.interview.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
  });
  const data = interviews.map((row) => ({
    interviewId: row.interviewId,
    url: `${baseUrl}/interview/${row.publicToken ?? row.interviewId}`,
    status: row.status,
    candidateName: row.candidateName ?? null,
    notes: row.interviewNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    hasRecording: Boolean(row.r2ObjectKey)
  }));

  return <AdminDashboard interviews={data} />;
}
