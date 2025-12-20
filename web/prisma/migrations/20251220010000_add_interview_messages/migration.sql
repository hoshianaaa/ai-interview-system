-- Add recording start timestamp
ALTER TABLE "Interview" ADD COLUMN "recordingStartedAt" TIMESTAMP(3);

-- Create enum for chat roles
CREATE TYPE "ChatRole" AS ENUM ('interviewer', 'candidate');

-- Create table for interview messages
CREATE TABLE "InterviewMessage" (
    "messageId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "orgId" TEXT,
    "role" "ChatRole" NOT NULL,
    "text" TEXT NOT NULL,
    "offsetMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewMessage_pkey" PRIMARY KEY ("messageId")
);

-- Indexes
CREATE INDEX "InterviewMessage_interviewId_idx" ON "InterviewMessage"("interviewId");
CREATE INDEX "InterviewMessage_orgId_idx" ON "InterviewMessage"("orgId");
CREATE INDEX "InterviewMessage_interviewId_offsetMs_idx" ON "InterviewMessage"("interviewId", "offsetMs");

-- Foreign key
ALTER TABLE "InterviewMessage"
  ADD CONSTRAINT "InterviewMessage_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("interviewId") ON DELETE CASCADE ON UPDATE CASCADE;
