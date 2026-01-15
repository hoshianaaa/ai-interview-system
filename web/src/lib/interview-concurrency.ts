import type { InterviewStatus, Prisma } from "@prisma/client";
import { getPlanConfig } from "@/lib/billing";
import {
  DEFAULT_MAX_CONCURRENT_INTERVIEWS,
  SYSTEM_SETTINGS_ID
} from "@/lib/system-settings";

const ACTIVE_INTERVIEW_STATUSES: InterviewStatus[] = ["used", "recording", "ending"];

type ConcurrencyClient = Pick<
  Prisma.TransactionClient,
  "interview" | "orgSubscription" | "systemSetting"
>;

export type ConcurrencyBlockReason = "GLOBAL_LIMIT" | "ORG_LIMIT";

export const getConcurrencyBlockReason = async (
  client: ConcurrencyClient,
  orgId: string | null | undefined
): Promise<ConcurrencyBlockReason | null> => {
  const settings = await client.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });
  const maxGlobal = settings?.maxConcurrentInterviews ?? DEFAULT_MAX_CONCURRENT_INTERVIEWS;
  if (maxGlobal > 0) {
    const activeGlobal = await client.interview.count({
      where: { status: { in: ACTIVE_INTERVIEW_STATUSES } }
    });
    if (activeGlobal >= maxGlobal) return "GLOBAL_LIMIT";
  }

  if (orgId) {
    const subscription = await client.orgSubscription.findUnique({ where: { orgId } });
    if (subscription) {
      const plan = getPlanConfig(subscription.plan);
      const maxOrg =
        typeof subscription.maxConcurrentInterviews === "number"
          ? subscription.maxConcurrentInterviews
          : plan.maxConcurrentInterviews;
      if (typeof maxOrg === "number" && maxOrg > 0) {
        const activeOrg = await client.interview.count({
          where: { orgId, status: { in: ACTIVE_INTERVIEW_STATUSES } }
        });
        if (activeOrg >= maxOrg) return "ORG_LIMIT";
      }
    }
  }

  return null;
};
