import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization") ?? "";

  const { webhook } = clients();

  let event: any;
  try {
    event = await webhook.receive(rawBody, authHeader);
  } catch {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }

  const roomName = event?.room?.name;
  if (!roomName) return NextResponse.json({ ok: true });

  const interview = await prisma.interview.findUnique({ where: { roomName } });
  if (!interview) return NextResponse.json({ ok: true });

  const ev = event?.event as string;
  const participantIdentity = event?.participant?.identity as string | undefined;

  // Start Egress when the candidate joins (simple + robust)
  if (ev === "participant_joined" || ev === "participant_connected") {
    if (participantIdentity === interview.candidateIdentity) {
      await prisma.interview.update({
        where: { interviewId: interview.interviewId },
        data: { candidateJoinedAt: interview.candidateJoinedAt ?? new Date() }
      });

      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}
