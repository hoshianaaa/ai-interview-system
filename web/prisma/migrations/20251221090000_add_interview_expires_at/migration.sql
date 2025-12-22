-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Backfill existing rows to default 1 week
UPDATE "Interview"
SET "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "expiresAt" IS NULL;
