import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { env, makeCandidateIdentity, makeRoomName } from "@/lib/livekit";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const durationRaw = Number(body.durationSec ?? 600);
  const normalizedDuration = Number.isFinite(durationRaw) ? Math.round(durationRaw) : 600;
  const durationSec = Math.min(1800, Math.max(60, normalizedDuration));
  const candidateName =
    typeof body.candidateName === "string" ? body.candidateName.trim() || null : null;
  const promptRaw = typeof body.prompt === "string" ? body.prompt : "";
  const prompt = promptRaw.trim() ? promptRaw.trim() : DEFAULT_INTERVIEW_PROMPT;

  const interviewId = crypto.randomUUID();
  const publicToken = crypto.randomUUID();
  const roomName = makeRoomName(interviewId);

  const interview = await prisma.interview.create({
    data: {
      interviewId,
      publicToken,
      orgId,
      roomName,
      durationSec,
      candidateIdentity: makeCandidateIdentity(interviewId),
      candidateName,
      interviewPrompt: prompt,
      agentName: body.agentName ?? env.agentName,
      r2Bucket: env.r2Bucket
    }
  });

  const url = `${env.baseUrl}/interview/${interview.publicToken ?? interview.interviewId}`;
  return NextResponse.json({
    interviewId: interview.interviewId,
    roomName,
    url,
    candidateName
  });
}
