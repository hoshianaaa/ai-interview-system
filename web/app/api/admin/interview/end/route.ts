import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";
import { refreshOrgSubscription } from "@/lib/subscription";
import { getProgressStatusLabel } from "@/lib/interview-status";

export const runtime = "nodejs";

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
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const interview = await prisma.interview.findFirst({
    where: { interviewId, orgId }
  });
  if (!interview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (interview.status === "completed") {
    const hasRecording = Boolean(interview.streamUid);
    return NextResponse.json({
      interviewId: interview.interviewId,
      status: getProgressStatusLabel({
        status: interview.status,
        expiresAt: interview.expiresAt,
        usedAt: interview.usedAt,
        hasRecording
      }),
      hasRecording
    });
  }

  await prisma.interview.update({
    where: { interviewId: interview.interviewId },
    data: { status: "ending" }
  });

  const { room } = clients();
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

  const updated = await prisma.interview.findUnique({
    where: { interviewId: interview.interviewId }
  });
  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const hasRecording = Boolean(updated.streamUid);
  return NextResponse.json({
    interviewId: updated.interviewId,
    status: getProgressStatusLabel({
      status: updated.status,
      expiresAt: updated.expiresAt,
      usedAt: updated.usedAt,
      hasRecording
    }),
    hasRecording
  });
}
