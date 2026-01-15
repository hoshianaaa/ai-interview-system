export type OrgPlan = "starter";

export type PlanConfig = {
  id: OrgPlan;
  label: string;
  monthlyPriceYen: number;
  includedMinutes: number;
  overageRateYenPerMin: number;
  overageLimitMinutes: number;
  maxConcurrentInterviews: number | null;
};

export const PLAN_CONFIG: Record<OrgPlan, PlanConfig> = {
  starter: {
    id: "starter",
    label: "Starter",
    monthlyPriceYen: 3000,
    includedMinutes: 100,
    overageRateYenPerMin: 30,
    overageLimitMinutes: 100,
    maxConcurrentInterviews: 1
  }
};

export const DEFAULT_PLAN_ID: OrgPlan = "starter";

export const getPlanConfig = (plan: OrgPlan): PlanConfig => PLAN_CONFIG[plan];

const getDaysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const addMonthsWithAnchor = (anchor: Date, monthsToAdd: number) => {
  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth();
  const anchorDay = anchor.getUTCDate();
  const anchorHour = anchor.getUTCHours();
  const anchorMinute = anchor.getUTCMinutes();
  const anchorSecond = anchor.getUTCSeconds();
  const anchorMs = anchor.getUTCMilliseconds();

  const targetMonthIndex = anchorMonth + monthsToAdd;
  const targetYear = anchorYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(anchorDay, lastDay);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      anchorHour,
      anchorMinute,
      anchorSecond,
      anchorMs
    )
  );
};

export const getCycleRange = (anchor: Date, now: Date) => {
  const anchorTime = anchor.getTime();
  if (now.getTime() < anchorTime) {
    return {
      start: anchor,
      end: addMonthsWithAnchor(anchor, 1)
    };
  }

  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth();
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth();
  let offset = (nowYear - anchorYear) * 12 + (nowMonth - anchorMonth);

  let start = addMonthsWithAnchor(anchor, offset);
  if (now.getTime() < start.getTime()) {
    offset -= 1;
    start = addMonthsWithAnchor(anchor, offset);
  }
  const end = addMonthsWithAnchor(anchor, offset + 1);

  return { start, end };
};

export const toRoundedMinutes = (sec: number, mode: "floor" | "ceil" = "floor") => {
  const safe = Math.max(0, sec);
  const raw = safe / 60;
  return mode === "ceil" ? Math.ceil(raw) : Math.floor(raw);
};

export const calcOverageYen = (overageSec: number, ratePerMin: number) =>
  toRoundedMinutes(overageSec, "ceil") * ratePerMin;

export type BillingSummary = {
  planId: OrgPlan;
  monthlyPriceYen: number;
  includedMinutes: number;
  overageRateYenPerMin: number;
  overageLimitMinutes: number;
  maxConcurrentInterviews: number | null;
  cycleStartedAt: Date;
  cycleEndsAt: Date;
  usedSec: number;
  reservedSec: number;
  remainingIncludedSec: number;
  overageUsedSec: number;
  overageChargeYen: number;
  overageRemainingSec: number;
  overageApproved: boolean;
  overageLocked: boolean;
};

export const buildBillingSummary = (subscription: {
  plan: OrgPlan;
  cycleStartedAt: Date;
  cycleEndsAt: Date;
  usedSec: number;
  reservedSec: number;
  overageApproved: boolean;
  overageLimitMinutes?: number | null;
  maxConcurrentInterviews?: number | null;
}): BillingSummary => {
  const plan = getPlanConfig(subscription.plan);
  const includedSec = plan.includedMinutes * 60;
  const committedSec = subscription.usedSec + subscription.reservedSec;
  const remainingIncludedSec = Math.max(0, includedSec - committedSec);
  const overageUsedSec = Math.max(0, subscription.usedSec - includedSec);
  const overageChargeYen = calcOverageYen(overageUsedSec, plan.overageRateYenPerMin);
  const overageLimitMinutes =
    subscription.overageLimitMinutes ?? plan.includedMinutes;
  const maxConcurrentInterviews =
    subscription.maxConcurrentInterviews ?? plan.maxConcurrentInterviews ?? null;
  const overageLimitSec = overageLimitMinutes * 60;
  const overageCommittedSec = Math.max(0, committedSec - includedSec);
  const overageRemainingSec = Math.max(0, overageLimitSec - overageCommittedSec);
  const overageLocked = overageRemainingSec === 0;

  return {
    planId: subscription.plan,
    monthlyPriceYen: plan.monthlyPriceYen,
    includedMinutes: plan.includedMinutes,
    overageRateYenPerMin: plan.overageRateYenPerMin,
    overageLimitMinutes,
    maxConcurrentInterviews,
    cycleStartedAt: subscription.cycleStartedAt,
    cycleEndsAt: subscription.cycleEndsAt,
    usedSec: subscription.usedSec,
    reservedSec: subscription.reservedSec,
    remainingIncludedSec,
    overageUsedSec,
    overageChargeYen,
    overageRemainingSec,
    overageApproved: subscription.overageApproved,
    overageLocked
  };
};
