import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_TOKEN_LENGTH = 128;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const publicToken = typeof body.publicToken === "string" ? body.publicToken.trim() : "";
  const legacyInterviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";

  if (!publicToken && !legacyInterviewId) {
    return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  }
  if (publicToken.length > MAX_TOKEN_LENGTH || legacyInterviewId.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json({ error: "token is too long" }, { status: 400 });
  }

  let interview = null;
  if (publicToken) {
    interview = await prisma.interview.findUnique({ where: { publicToken } });
  }
  const legacyLookupId = legacyInterviewId || publicToken;
  if (!interview && legacyLookupId) {
    interview = await prisma.interview.findUnique({ where: { interviewId: legacyLookupId } });
  }
  if (!interview) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.interview.update({
    where: { interviewId: interview.interviewId },
    data: {
      status: interview.status === "used" ? "recording" : interview.status,
      recordingStartedAt: interview.recordingStartedAt ?? new Date()
    }
  });

  return NextResponse.json({ ok: true });
}
