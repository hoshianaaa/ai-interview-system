import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients, env, makeCandidateToken } from "@/lib/livekit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { interviewId } = await req.json();

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const { dispatch } = clients();

  const updated = await prisma
    .$transaction(async (tx) => {
      const current = await tx.interview.findUnique({ where: { interviewId } });
      if (!current) return null;

      if (current.status !== "created") {
        throw new Error("INTERVIEW_ALREADY_USED");
      }

      return tx.interview.update({
        where: { interviewId },
        data: { status: "used", usedAt: new Date() }
      });
    })
    .catch((e) => {
      if (String(e?.message) === "INTERVIEW_ALREADY_USED") return "ALREADY_USED" as const;
      throw e;
    });

  if (updated === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (updated === "ALREADY_USED")
    return NextResponse.json({ error: "INTERVIEW_ALREADY_USED" }, { status: 409 });

  // Explicit dispatch: agent must be running and registered with matching agent_name
  const dispatchInfo = await dispatch.createDispatch(updated.roomName, updated.agentName);

  await prisma.interview.update({
    where: { interviewId },
    data: { dispatchId: dispatchInfo.id }
  });

  const token = makeCandidateToken({
    roomName: updated.roomName,
    identity: updated.candidateIdentity,
    ttlSeconds: Math.max(updated.durationSec + 600, 1800)
  });

  return NextResponse.json({
    livekitUrl: env.livekitUrl,
    roomName: updated.roomName,
    token,
    durationSec: updated.durationSec
  });
}
