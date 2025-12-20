-- Add interview outcome
CREATE TYPE "InterviewOutcome" AS ENUM ('pass', 'fail', 'hold');

ALTER TABLE "Interview"
  ADD COLUMN "outcome" "InterviewOutcome" NOT NULL DEFAULT 'hold';
