import AdminDashboard from "./admin/AdminDashboard";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const interviews = await prisma.interview.findMany({
    orderBy: { createdAt: "desc" }
  });
  const data = interviews.map((row) => ({
    interviewId: row.interviewId,
    url: `${baseUrl}/interview/${row.interviewId}`,
    status: row.status,
    candidateName: row.candidateName ?? null,
    createdAt: row.createdAt.toISOString(),
    hasRecording: Boolean(row.r2ObjectKey)
  }));

  return <AdminDashboard interviews={data} />;
}
