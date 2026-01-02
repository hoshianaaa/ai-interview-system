import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createStreamDirectUpload } from "@/lib/stream";

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

  const result = await createStreamDirectUpload({
    metadata: {
      interviewId: interview.interviewId,
      roomName: interview.roomName,
      orgId: interview.orgId ?? "unknown"
    },
    maxDurationSeconds: Math.max(interview.durationSec, 600) + 600
  });

  await prisma.interview.update({
    where: { interviewId: interview.interviewId },
    data: {
      streamUid: result.uid,
      status: interview.status === "used" ? "recording" : interview.status,
      recordingStartedAt: interview.recordingStartedAt ?? new Date()
    }
  });

  return NextResponse.json({ uploadUrl: result.uploadURL, uid: result.uid });
}
