import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId } from "@/lib/super-admin";
import {
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
  if (!hasOverage && !hasPlan && !hasRenew) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION_INPUT" }, { status: 400 });
  }

  let nextOverageApproved: boolean | null = null;
  if (hasOverage) {
    nextOverageApproved = parseBoolean(body.overageApproved);
    if (nextOverageApproved === null) {
      return NextResponse.json({ error: "INVALID_OVERAGE_INPUT" }, { status: 400 });
    }
  }

  let nextRenewOnCycleEnd: boolean | null = null;
  if (hasRenew) {
    nextRenewOnCycleEnd = parseBoolean(body.renewOnCycleEnd);
    if (nextRenewOnCycleEnd === null) {
      return NextResponse.json({ error: "INVALID_RENEW_INPUT" }, { status: 400 });
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
    const cycle = getCycleRange(now, now);
    updated = await prisma.orgSubscription.create({
      data: {
        orgId: targetOrgId,
        plan: nextPlanId,
        billingAnchorAt: now,
        cycleStartedAt: cycle.start,
        cycleEndsAt: cycle.end,
        usedSec: 0,
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
      const cycle = getCycleRange(now, now);
      data.plan = nextPlanId;
      data.billingAnchorAt = now;
      data.cycleStartedAt = cycle.start;
      data.cycleEndsAt = cycle.end;
      data.usedSec = 0;
      data.reservedSec = 0;
    }
    if (nextOverageApproved !== null) {
      data.overageApproved = nextOverageApproved;
    }
    if (nextRenewOnCycleEnd !== null) {
      data.renewOnCycleEnd = nextRenewOnCycleEnd;
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
