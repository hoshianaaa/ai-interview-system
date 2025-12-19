import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env, makeCandidateIdentity, makeRoomName } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const durationSec = Number(body.durationSec ?? 600);
  const candidateName =
    typeof body.candidateName === "string" ? body.candidateName.trim() || null : null;

  const interviewId = crypto.randomUUID();
  const roomName = makeRoomName(interviewId);

  const interview = await prisma.interview.create({
    data: {
      interviewId,
      roomName,
      durationSec,
      candidateIdentity: makeCandidateIdentity(interviewId),
      candidateName,
      agentName: body.agentName ?? env.agentName,
      r2Bucket: env.r2Bucket
    }
  });

  const url = `${env.baseUrl}/interview/${interview.interviewId}`;
  return NextResponse.json({
    interviewId: interview.interviewId,
    roomName,
    url,
    candidateName
  });
}
