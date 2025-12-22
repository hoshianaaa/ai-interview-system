-- CreateTable
CREATE TABLE "Application" (
    "applicationId" TEXT NOT NULL,
    "orgId" TEXT,
    "candidateName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("applicationId")
);

CREATE INDEX "Application_orgId_idx" ON "Application"("orgId");

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "applicationId" TEXT;
ALTER TABLE "Interview" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;

-- Backfill
INSERT INTO "Application" ("applicationId", "orgId", "candidateName", "createdAt", "updatedAt")
SELECT "interviewId", "orgId", "candidateName", "createdAt", "createdAt"
FROM "Interview";

UPDATE "Interview" SET "applicationId" = "interviewId" WHERE "applicationId" IS NULL;

ALTER TABLE "Interview" ALTER COLUMN "applicationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("applicationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");

-- Drop old column
ALTER TABLE "Interview" DROP COLUMN "candidateName";
