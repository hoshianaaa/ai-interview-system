import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { interviewId } = await req.json();

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const { egress, room } = clients();
  const interview = await prisma.interview.findUnique({ where: { interviewId } });
  if (!interview) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (interview.status === "completed") {
    return NextResponse.json({ ok: true, status: "completed", r2ObjectKey: interview.r2ObjectKey ?? null });
  }

  await prisma.interview.update({ where: { interviewId }, data: { status: "ending" } });

  if (interview.egressId) {
    try {
      await egress.stopEgress(interview.egressId);
    } catch {}
  }

  try {
    await room.deleteRoom(interview.roomName);
  } catch {}

  await prisma.interview.update({
    where: { interviewId },
    data: { status: "completed", endedAt: new Date() }
  });

  return NextResponse.json({ ok: true, r2ObjectKey: interview.r2ObjectKey ?? null });
}
