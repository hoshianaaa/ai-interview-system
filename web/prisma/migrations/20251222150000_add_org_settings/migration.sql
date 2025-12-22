-- CreateTable
CREATE TABLE "OrgSetting" (
    "orgId" TEXT NOT NULL,
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 10,
    "defaultExpiresWeeks" INTEGER NOT NULL DEFAULT 1,
    "defaultExpiresDays" INTEGER NOT NULL DEFAULT 0,
    "defaultExpiresHours" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSetting_pkey" PRIMARY KEY ("orgId")
);
