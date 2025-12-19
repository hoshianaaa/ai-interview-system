-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('created', 'used', 'recording', 'ending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Interview" (
    "interviewId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'created',
    "durationSec" INTEGER NOT NULL,
    "candidateIdentity" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "dispatchId" TEXT,
    "egressId" TEXT,
    "r2Bucket" TEXT NOT NULL,
    "r2ObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "candidateJoinedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("interviewId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Interview_roomName_key" ON "Interview"("roomName");
