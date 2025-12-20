import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const publicToken = typeof body.publicToken === "string" ? body.publicToken.trim() : "";
  const legacyInterviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";

  if (!publicToken && !legacyInterviewId) {
    return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  }

  const { egress, room } = clients();
  let interview = null;
  if (publicToken) {
    interview = await prisma.interview.findUnique({ where: { publicToken } });
  }
  const legacyLookupId = legacyInterviewId || publicToken;
  if (!interview && legacyLookupId) {
    interview = await prisma.interview.findUnique({ where: { interviewId: legacyLookupId } });
  }
  if (!interview) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (interview.status === "completed") {
    return NextResponse.json({ ok: true, status: "completed", r2ObjectKey: interview.r2ObjectKey ?? null });
  }

  await prisma.interview.update({ where: { interviewId: interview.interviewId }, data: { status: "ending" } });

  if (interview.egressId) {
    try {
      await egress.stopEgress(interview.egressId);
    } catch {}
  }

  try {
    await room.deleteRoom(interview.roomName);
  } catch {}

  await prisma.interview.update({
    where: { interviewId: interview.interviewId },
    data: { status: "completed", endedAt: new Date() }
  });

  return NextResponse.json({ ok: true, r2ObjectKey: interview.r2ObjectKey ?? null });
}
