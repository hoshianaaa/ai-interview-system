-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('starter');

-- CreateTable
CREATE TABLE "OrgSubscription" (
    "orgId" TEXT NOT NULL,
    "plan" "OrgPlan" NOT NULL,
    "billingAnchorAt" TIMESTAMP(3) NOT NULL,
    "cycleStartedAt" TIMESTAMP(3) NOT NULL,
    "cycleEndsAt" TIMESTAMP(3) NOT NULL,
    "usedSec" INTEGER NOT NULL DEFAULT 0,
    "reservedSec" INTEGER NOT NULL DEFAULT 0,
    "overageApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSubscription_pkey" PRIMARY KEY ("orgId")
);

-- DropTable
DROP TABLE "OrgQuota";
