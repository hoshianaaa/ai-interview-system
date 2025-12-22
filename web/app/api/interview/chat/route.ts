import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 2000;
const MAX_TOKEN_LENGTH = 128;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const publicToken = typeof body.publicToken === "string" ? body.publicToken.trim() : "";
  const legacyInterviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const msg = typeof body.message === "object" && body.message ? body.message : {};

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!publicToken && !legacyInterviewId) {
    return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  }
  if (publicToken.length > MAX_TOKEN_LENGTH || legacyInterviewId.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json({ error: "token is too long" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
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

  const role = msg.role === "candidate" ? "candidate" : "interviewer";
  const messageId =
    typeof msg.messageId === "string"
      ? msg.messageId
      : typeof msg.id === "string"
        ? msg.id
        : crypto.randomUUID();

  const baseTime =
    interview.recordingStartedAt ?? interview.usedAt ?? interview.createdAt ?? new Date();
  const offsetMs = Math.max(0, Date.now() - baseTime.getTime());
  const safeText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

  await prisma.interviewMessage.upsert({
    where: { messageId },
    update: {},
    create: {
      messageId,
      interviewId: interview.interviewId,
      orgId: interview.orgId ?? null,
      role,
      text: safeText,
      offsetMs
    }
  });

  return NextResponse.json({ ok: true });
}
