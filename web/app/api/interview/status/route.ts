import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInterviewExpired } from "@/lib/interview-status";
import { getConcurrencyBlockReason } from "@/lib/interview-concurrency";

export const runtime = "nodejs";

const MAX_TOKEN_LENGTH = 128;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publicToken = (searchParams.get("publicToken") ?? "").trim();
  if (!publicToken) {
    return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  }
  if (publicToken.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json({ error: "token is too long" }, { status: 400 });
  }

  const interview =
    (await prisma.interview.findUnique({ where: { publicToken } })) ??
    (await prisma.interview.findUnique({ where: { interviewId: publicToken } }));

  if (!interview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (
    interview.status === "created" &&
    !interview.usedAt &&
    isInterviewExpired(interview.expiresAt)
  ) {
    return NextResponse.json({ error: "INTERVIEW_EXPIRED" }, { status: 410 });
  }

  if (interview.status === "created") {
    const blockedReason = await getConcurrencyBlockReason(prisma, interview.orgId);
    if (blockedReason) {
      return NextResponse.json({
        status: interview.status,
        blockedReason: "CONCURRENCY_LIMIT"
      });
    }
  }

  return NextResponse.json({ status: interview.status });
}
