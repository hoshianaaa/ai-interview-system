-- Add notification status for interview outcome
CREATE TYPE "NotificationStatus" AS ENUM ('not_sent', 'sent');

ALTER TABLE "Interview"
  ADD COLUMN "notificationStatus" "NotificationStatus" NOT NULL DEFAULT 'not_sent',
  ADD COLUMN "notifiedAt" TIMESTAMP(3);
