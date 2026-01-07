import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  clients,
  env,
  makeCandidateToken
} from "@/lib/livekit";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";
import { isInterviewExpired } from "@/lib/interview-status";
import { getConcurrencyBlockReason } from "@/lib/interview-concurrency";

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

  const { dispatch, room } = clients();

  const updated = await prisma
    .$transaction(async (tx) => {
      let current = null;
      if (publicToken) {
        current = await tx.interview.findUnique({ where: { publicToken } });
      }
      const legacyLookupId = legacyInterviewId || publicToken;
      if (!current && legacyLookupId) {
        current = await tx.interview.findUnique({ where: { interviewId: legacyLookupId } });
      }
      if (!current) return null;

      if (
        current.status === "created" &&
        !current.usedAt &&
        isInterviewExpired(current.expiresAt)
      ) {
        throw new Error("INTERVIEW_EXPIRED");
      }

      if (current.status !== "created") {
        throw new Error("INTERVIEW_ALREADY_USED");
      }

      const blockedReason = await getConcurrencyBlockReason(tx, current.orgId);
      if (blockedReason) {
        throw new Error("INTERVIEW_CONCURRENCY_LIMIT");
      }

      return tx.interview.update({
        where: { interviewId: current.interviewId },
        data: { status: "used", usedAt: new Date() }
      });
    })
    .catch((e) => {
      if (String(e?.message) === "INTERVIEW_ALREADY_USED") return "ALREADY_USED" as const;
      if (String(e?.message) === "INTERVIEW_EXPIRED") return "EXPIRED" as const;
      if (String(e?.message) === "INTERVIEW_CONCURRENCY_LIMIT")
        return "CONCURRENCY_LIMIT" as const;
      throw e;
    });

  if (updated === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (updated === "ALREADY_USED")
    return NextResponse.json({ error: "INTERVIEW_ALREADY_USED" }, { status: 409 });
  if (updated === "EXPIRED")
    return NextResponse.json({ error: "INTERVIEW_EXPIRED" }, { status: 410 });
  if (updated === "CONCURRENCY_LIMIT")
    return NextResponse.json(
      { error: "INTERVIEW_CONCURRENCY_LIMIT" },
      { status: 429 }
    );

  try {
    await room.createRoom({ name: updated.roomName });
  } catch {}

  const dispatchPrompt =
    typeof updated.interviewPrompt === "string" && updated.interviewPrompt.trim()
      ? updated.interviewPrompt
      : DEFAULT_INTERVIEW_PROMPT;
  // Explicit dispatch: agent must be running and registered with matching agent_name
  const dispatchInfo = await dispatch.createDispatch(updated.roomName, updated.agentName, {
    metadata: JSON.stringify({ prompt: dispatchPrompt })
  });

  await prisma.interview.update({
    where: { interviewId: updated.interviewId },
    data: { dispatchId: dispatchInfo.id }
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
