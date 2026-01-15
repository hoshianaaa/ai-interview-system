import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId } from "@/lib/super-admin";
import {
  getPlanConfig,
  PLAN_CONFIG,
  getCycleRange,
  type OrgPlan
} from "@/lib/billing";

export const runtime = "nodejs";

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeOrgId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const parsePlanId = (value: unknown) => {
  if (value === null) return { planId: null, ok: true };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { planId: null, ok: true };
    if (isPlanId(trimmed)) return { planId: trimmed, ok: true };
    return { planId: null, ok: false };
  }
  return { planId: null, ok: false };
};

const isPlanId = (value: string): value is OrgPlan =>
  Object.prototype.hasOwnProperty.call(PLAN_CONFIG, value);

const parseBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const parseNonNegativeInt = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }
  return null;
};

const parsePlanStartDate = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }
  if (!isSuperAdminOrgId(orgId)) {
    return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 });
  }

  const subscriptions = await prisma.orgSubscription.findMany({
    orderBy: { orgId: "asc" }
  });
  return NextResponse.json({
    orgSubscriptions: subscriptions.map((row) => ({
      orgId: row.orgId,
      plan: row.plan,
      billingAnchorAt: row.billingAnchorAt.toISOString(),
      cycleStartedAt: row.cycleStartedAt.toISOString(),
      cycleEndsAt: row.cycleEndsAt.toISOString(),
      usedSec: row.usedSec,
      reservedSec: row.reservedSec,
      overageApproved: row.overageApproved,
      renewOnCycleEnd: row.renewOnCycleEnd,
      updatedAt: row.updatedAt.toISOString()
    }))
  });
}

export async function PATCH(req: Request) {
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

  const hasOverage = hasOwn(body, "overageApproved");
  const hasPlan = hasOwn(body, "planId");
  const hasRenew = hasOwn(body, "renewOnCycleEnd");
  const hasRemainingConfirmed = hasOwn(body, "remainingConfirmedMin");
  const hasOverageConfirmed = hasOwn(body, "overageConfirmedMin");
  const hasPlanStartDate = hasOwn(body, "planStartDate");
  if (
    !hasOverage &&
    !hasPlan &&
    !hasRenew &&
    !hasRemainingConfirmed &&
    !hasOverageConfirmed &&
    !hasPlanStartDate
  ) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION_INPUT" }, { status: 400 });
  }

  let nextOverageApproved: boolean | null = null;
  if (hasOverage) {
    nextOverageApproved = parseBoolean(body.overageApproved);
    if (nextOverageApproved === null) {
      return NextResponse.json({ error: "INVALID_OVERAGE_INPUT" }, { status: 400 });
    }
  }

  let remainingConfirmedMin: number | null = null;
  if (hasRemainingConfirmed) {
    remainingConfirmedMin = parseNonNegativeInt(body.remainingConfirmedMin);
    if (remainingConfirmedMin === null) {
      return NextResponse.json(
        { error: "INVALID_REMAINING_CONFIRMED" },
        { status: 400 }
      );
    }
  }

  let overageConfirmedMin: number | null = null;
  if (hasOverageConfirmed) {
    overageConfirmedMin = parseNonNegativeInt(body.overageConfirmedMin);
    if (overageConfirmedMin === null) {
      return NextResponse.json(
        { error: "INVALID_OVERAGE_CONFIRMED" },
        { status: 400 }
      );
    }
  }

  if (
    remainingConfirmedMin !== null &&
    overageConfirmedMin !== null &&
    remainingConfirmedMin > 0 &&
    overageConfirmedMin > 0
  ) {
    return NextResponse.json(
      { error: "REMAINING_AND_OVERAGE_CONFLICT" },
      { status: 400 }
    );
  }

  let nextRenewOnCycleEnd: boolean | null = null;
  if (hasRenew) {
    nextRenewOnCycleEnd = parseBoolean(body.renewOnCycleEnd);
    if (nextRenewOnCycleEnd === null) {
      return NextResponse.json({ error: "INVALID_RENEW_INPUT" }, { status: 400 });
    }
  }

  let planStartDate: Date | null = null;
  if (hasPlanStartDate) {
    planStartDate = parsePlanStartDate(body.planStartDate);
    if (!planStartDate) {
      return NextResponse.json({ error: "INVALID_PLAN_START_DATE" }, { status: 400 });
    }
  }

  let nextPlanId: OrgPlan | null | undefined;
  if (hasPlan) {
    const parsed = parsePlanId(body.planId);
    if (!parsed.ok) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND" }, { status: 400 });
    }
    nextPlanId = parsed.planId;
  }

  const now = new Date();
  const current = await prisma.orgSubscription.findUnique({
    where: { orgId: targetOrgId }
  });
  let updated = current;
  if (!current) {
    if (nextPlanId === undefined) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    }
    if (nextPlanId === null) {
      return NextResponse.json({ orgSubscription: null });
    }
    const anchor = planStartDate ?? now;
    const cycle = getCycleRange(anchor, now);
    const includedMin = getPlanConfig(nextPlanId).includedMinutes;
    let usedSec = 0;
    if (remainingConfirmedMin !== null || overageConfirmedMin !== null) {
      if (remainingConfirmedMin !== null && remainingConfirmedMin > includedMin) {
        return NextResponse.json(
          { error: "REMAINING_EXCEEDS_INCLUDED" },
          { status: 400 }
        );
      }
      if (overageConfirmedMin !== null && overageConfirmedMin > 0) {
        usedSec = (includedMin + overageConfirmedMin) * 60;
      } else if (remainingConfirmedMin !== null) {
        usedSec = Math.max(0, includedMin - remainingConfirmedMin) * 60;
      } else {
        usedSec = (includedMin + (overageConfirmedMin ?? 0)) * 60;
      }
    }
    updated = await prisma.orgSubscription.create({
      data: {
        orgId: targetOrgId,
        plan: nextPlanId,
        billingAnchorAt: anchor,
        cycleStartedAt: cycle.start,
        cycleEndsAt: cycle.end,
        usedSec,
        reservedSec: 0,
        overageApproved: nextOverageApproved ?? false,
        renewOnCycleEnd: nextRenewOnCycleEnd ?? false
      }
    });
  } else {
    if (nextPlanId === null) {
      await prisma.orgSubscription.delete({ where: { orgId: targetOrgId } });
      return NextResponse.json({ orgSubscription: null });
    }
    const targetPlanId = nextPlanId ?? current.plan;
    const data: {
      plan?: OrgPlan;
      billingAnchorAt?: Date;
      cycleStartedAt?: Date;
      cycleEndsAt?: Date;
      usedSec?: number;
      reservedSec?: number;
      overageApproved?: boolean;
      renewOnCycleEnd?: boolean;
    } = {};
    if (nextPlanId) {
      const anchor = planStartDate ?? now;
      const cycle = getCycleRange(anchor, now);
      data.plan = nextPlanId;
      data.billingAnchorAt = anchor;
      data.cycleStartedAt = cycle.start;
      data.cycleEndsAt = cycle.end;
      data.usedSec = 0;
      data.reservedSec = 0;
    }
    if (planStartDate && !nextPlanId) {
      const cycle = getCycleRange(planStartDate, now);
      data.billingAnchorAt = planStartDate;
      data.cycleStartedAt = cycle.start;
      data.cycleEndsAt = cycle.end;
    }
    if (nextOverageApproved !== null) {
      data.overageApproved = nextOverageApproved;
    }
    if (nextRenewOnCycleEnd !== null) {
      data.renewOnCycleEnd = nextRenewOnCycleEnd;
    }
    if (remainingConfirmedMin !== null || overageConfirmedMin !== null) {
      const includedMin = getPlanConfig(targetPlanId).includedMinutes;
      if (remainingConfirmedMin !== null && remainingConfirmedMin > includedMin) {
        return NextResponse.json(
          { error: "REMAINING_EXCEEDS_INCLUDED" },
          { status: 400 }
        );
      }
      if (overageConfirmedMin !== null && overageConfirmedMin > 0) {
        data.usedSec = (includedMin + overageConfirmedMin) * 60;
      } else if (remainingConfirmedMin !== null) {
        data.usedSec = Math.max(0, includedMin - remainingConfirmedMin) * 60;
      } else {
        data.usedSec = (includedMin + (overageConfirmedMin ?? 0)) * 60;
      }
    }
    updated = await prisma.orgSubscription.update({
      where: { orgId: targetOrgId },
      data
    });
  }

  return NextResponse.json({
    orgSubscription: {
      orgId: updated.orgId,
      plan: updated.plan,
      billingAnchorAt: updated.billingAnchorAt.toISOString(),
      cycleStartedAt: updated.cycleStartedAt.toISOString(),
      cycleEndsAt: updated.cycleEndsAt.toISOString(),
      usedSec: updated.usedSec,
      reservedSec: updated.reservedSec,
      overageApproved: updated.overageApproved,
      renewOnCycleEnd: updated.renewOnCycleEnd,
      updatedAt: updated.updatedAt.toISOString()
    }
  });
}
