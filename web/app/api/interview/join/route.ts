import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  clients,
  env,
  makeCandidateToken,
  buildRoomCompositeOutput,
  defaultCompositeOpts
} from "@/lib/livekit";
import { makeR2ObjectKey } from "@/lib/recordings";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { interviewId } = await req.json();

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const { dispatch, room, egress } = clients();

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

  try {
    await room.createRoom({ name: updated.roomName });
  } catch {}

  // Explicit dispatch: agent must be running and registered with matching agent_name
  const dispatchInfo = await dispatch.createDispatch(updated.roomName, updated.agentName);

  await prisma.interview.update({
    where: { interviewId },
    data: { dispatchId: dispatchInfo.id }
  });

  const objectKey = makeR2ObjectKey({
    interviewId: updated.interviewId,
    roomName: updated.roomName
  });

  let egressInfo: { egressId: string };
  try {
    egressInfo = await egress.startRoomCompositeEgress(
      updated.roomName,
      buildRoomCompositeOutput(objectKey),
      defaultCompositeOpts
    );
  } catch (err) {
    await prisma.interview.update({
      where: { interviewId: updated.interviewId },
      data: { status: "failed", error: `EGRESS_START_FAILED: ${String(err)}` }
    });
    return NextResponse.json({ error: "EGRESS_START_FAILED" }, { status: 500 });
  }

  await prisma.interview.update({
    where: { interviewId: updated.interviewId },
    data: { status: "recording", egressId: egressInfo.egressId, r2ObjectKey: objectKey }
  });

  const token = await makeCandidateToken({
    roomName: updated.roomName,
    identity: updated.candidateIdentity,
    ttlSeconds: Math.max(updated.durationSec + 600, 1800)
  });

  if (typeof token !== "string" || token.length < 10) {
    console.error("[interview/join] invalid token", {
      type: typeof token,
      length: typeof token === "string" ? token.length : null
    });
    return NextResponse.json({ error: "TOKEN_INVALID" }, { status: 500 });
  }

  return NextResponse.json({
    livekitUrl: env.livekitUrl,
    roomName: updated.roomName,
    token,
    durationSec: updated.durationSec
  });
}
