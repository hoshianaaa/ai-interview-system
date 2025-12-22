-- CreateEnum
CREATE TYPE "InterviewDecision" AS ENUM ('undecided', 'pass', 'fail', 'hold');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "decision" "InterviewDecision" NOT NULL DEFAULT 'undecided';
