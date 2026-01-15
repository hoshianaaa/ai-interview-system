import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { clients } from "@/lib/livekit";
import { refreshOrgSubscription } from "@/lib/subscription";
import { isSuperAdminOrgId } from "@/lib/super-admin";

export const runtime = "nodejs";

const ACTIVE_INTERVIEW_STATUSES = ["used", "recording", "ending"] as const;
const MIN_BILLABLE_DURATION_SEC = 60;

const normalizeOrgId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

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
  if (!isSuperAdminOrgId(orgId)) {
    return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const targetOrgId = normalizeOrgId(body.orgId);
  if (!targetOrgId) {
    return NextResponse.json({ error: "ORG_ID_REQUIRED" }, { status: 400 });
  }

  const activeInterviews = await prisma.interview.findMany({
    where: {
      orgId: targetOrgId,
      status: { in: ACTIVE_INTERVIEW_STATUSES }
    },
    select: { interviewId: true, roomName: true }
  });

  const { room } = clients();
  let endedCount = 0;

  for (const interview of activeInterviews) {
    await prisma.interview
      .update({
        where: { interviewId: interview.interviewId },
        data: { status: "ending" }
      })
      .catch(() => null);

    try {
      await room.deleteRoom(interview.roomName);
    } catch {}

    const endedAt = new Date();
    const ended = await prisma.$transaction(async (tx) => {
      const current = await tx.interview.findUnique({
        where: { interviewId: interview.interviewId }
      });
      if (!current || current.status === "completed") return false;

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

      return true;
    });

    if (ended) endedCount += 1;
  }

  const activeInterviewCount = await prisma.interview.count({
    where: {
      orgId: targetOrgId,
      status: { in: ACTIVE_INTERVIEW_STATUSES }
    }
  });
  const subscription = await prisma.orgSubscription.findUnique({
    where: { orgId: targetOrgId }
  });

  return NextResponse.json({
    endedCount,
    activeInterviewCount,
    orgSubscription: subscription
      ? {
          orgId: subscription.orgId,
          plan: subscription.plan,
          billingAnchorAt: subscription.billingAnchorAt.toISOString(),
          cycleStartedAt: subscription.cycleStartedAt.toISOString(),
          cycleEndsAt: subscription.cycleEndsAt.toISOString(),
          usedSec: subscription.usedSec,
          reservedSec: subscription.reservedSec,
          overageApproved: subscription.overageApproved,
          renewOnCycleEnd: subscription.renewOnCycleEnd,
          updatedAt: subscription.updatedAt.toISOString()
        }
      : null
  });
}
