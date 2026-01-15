import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";
import { refreshOrgSubscription } from "@/lib/subscription";

export const runtime = "nodejs";

const MAX_TOKEN_LENGTH = 128;
const MIN_BILLABLE_DURATION_SEC = 60;

const resolveActualDurationSec = (
  interview: { candidateJoinedAt: Date | null; usedAt: Date | null },
  endedAt: Date
) => {
  const startedAt = interview.candidateJoinedAt ?? interview.usedAt;
  if (!startedAt) return 0;
  const diffMs = endedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.round(diffMs / 1000));
};

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

  const { room } = clients();
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
    return NextResponse.json({ ok: true, status: "completed" });
  }

  await prisma.interview.update({ where: { interviewId: interview.interviewId }, data: { status: "ending" } });

  try {
    await room.deleteRoom(interview.roomName);
  } catch {}

  const endedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.interview.findUnique({
      where: { interviewId: interview.interviewId }
    });
    if (!current || current.status === "completed") return;

    const actualDurationSec =
      current.actualDurationSec ?? resolveActualDurationSec(current, endedAt);
    const billableDurationSec =
      actualDurationSec > 0
        ? Math.max(MIN_BILLABLE_DURATION_SEC, actualDurationSec)
        : 0;
    const reservedSec = current.quotaReservedSec ?? 0;
    const billedSec =
      reservedSec > 0
        ? Math.min(reservedSec, billableDurationSec)
        : billableDurationSec;
    const shouldSettle = reservedSec > 0 && !current.quotaSettledAt;
    if (shouldSettle && current.orgId) {
      let subscription = await tx.orgSubscription.findUnique({
        where: { orgId: current.orgId }
      });
      if (subscription) {
        subscription = await refreshOrgSubscription(tx, subscription, endedAt);
        if (subscription) {
          const nextReservedSec = Math.max(0, subscription.reservedSec - reservedSec);
          await tx.orgSubscription.update({
            where: { orgId: subscription.orgId },
            data: {
              usedSec: { increment: billedSec },
              reservedSec: nextReservedSec
            }
          });
        }
      }
    }

    await tx.interview.update({
      where: { interviewId: current.interviewId },
      data: {
        status: "completed",
        endedAt,
        ...(current.actualDurationSec ? {} : { actualDurationSec }),
        ...(shouldSettle ? { quotaSettledAt: endedAt } : {})
      }
    });
  });

  return NextResponse.json({ ok: true });
}
