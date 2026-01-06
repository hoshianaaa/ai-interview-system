import type { OrgSubscription, Prisma } from "@prisma/client";
import { getCycleRange } from "@/lib/billing";

type SubscriptionClient = Pick<Prisma.TransactionClient, "orgSubscription">;

export const refreshOrgSubscription = async (
  client: SubscriptionClient,
  subscription: OrgSubscription,
  now: Date
): Promise<OrgSubscription | null> => {
  const nowMs = now.getTime();
  const cycleEnded = nowMs >= subscription.cycleEndsAt.getTime();
  const effectiveNow = cycleEnded ? new Date(nowMs + 1) : now;
  const cycle = getCycleRange(subscription.billingAnchorAt, effectiveNow);
  const cycleChanged =
    subscription.cycleStartedAt.getTime() !== cycle.start.getTime() ||
    subscription.cycleEndsAt.getTime() !== cycle.end.getTime();

  if (!cycleChanged) return subscription;

  if (cycleEnded && !subscription.renewOnCycleEnd) {
    await client.orgSubscription.delete({ where: { orgId: subscription.orgId } });
    return null;
  }

  const data: Prisma.OrgSubscriptionUpdateInput = {
    cycleStartedAt: cycle.start,
    cycleEndsAt: cycle.end,
    usedSec: 0,
    reservedSec: 0
  };

  if (cycleEnded && subscription.renewOnCycleEnd) {
    data.renewOnCycleEnd = false;
  }

  return client.orgSubscription.update({
    where: { orgId: subscription.orgId },
    data
  });
};
