-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "actualDurationSec" INTEGER;
ALTER TABLE "Interview" ADD COLUMN "quotaReservedSec" INTEGER;
ALTER TABLE "Interview" ADD COLUMN "quotaSettledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrgQuota" (
    "orgId" TEXT NOT NULL,
    "availableSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgQuota_pkey" PRIMARY KEY ("orgId")
);
