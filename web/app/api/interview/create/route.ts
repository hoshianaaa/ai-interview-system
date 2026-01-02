import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { env, makeCandidateIdentity, makeRoomName } from "@/lib/livekit";
import { DEFAULT_INTERVIEW_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";

const MAX_CANDIDATE_NAME = 80;
const MAX_CANDIDATE_EMAIL = 254;
const MAX_PROMPT_CHARS = 4000;
const MAX_EXPIRES_WEEKS = 4;
const MAX_EXPIRES_DAYS = 6;
const MAX_EXPIRES_HOURS = 23;
const DEFAULT_EXPIRES_WEEKS = 1;

const parseDurationPart = (value: unknown, max: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const normalized = Math.floor(num);
  return Math.min(max, Math.max(0, normalized));
};

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const durationRaw = Number(body.durationSec ?? 600);
  const normalizedDuration = Number.isFinite(durationRaw) ? Math.round(durationRaw) : 600;
  const durationSec = Math.min(1800, Math.max(60, normalizedDuration));
  const applicationIdRaw =
    typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const roundRaw = Number(body.round);
  const roundOverride =
    Number.isFinite(roundRaw) && roundRaw > 0 ? Math.floor(roundRaw) : null;
  const candidateName =
    typeof body.candidateName === "string" ? body.candidateName.trim() || null : null;
  const candidateEmail =
    typeof body.candidateEmail === "string" ? body.candidateEmail.trim() || null : null;
  const promptRaw = typeof body.prompt === "string" ? body.prompt : "";
  const promptTrimmed = promptRaw.trim();
  if (!applicationIdRaw && candidateName && candidateName.length > MAX_CANDIDATE_NAME) {
    return NextResponse.json({ error: "CANDIDATE_NAME_TOO_LONG" }, { status: 400 });
  }
  if (!applicationIdRaw && candidateEmail && candidateEmail.length > MAX_CANDIDATE_EMAIL) {
    return NextResponse.json({ error: "CANDIDATE_EMAIL_TOO_LONG" }, { status: 400 });
  }
  if (!applicationIdRaw && candidateEmail && !candidateEmail.includes("@")) {
    return NextResponse.json({ error: "CANDIDATE_EMAIL_INVALID" }, { status: 400 });
  }
  if (promptTrimmed.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "PROMPT_TOO_LONG" }, { status: 400 });
  }
  const prompt = promptTrimmed ? promptTrimmed : DEFAULT_INTERVIEW_PROMPT;

  let expiresInWeeks = parseDurationPart(body.expiresInWeeks, MAX_EXPIRES_WEEKS);
  let expiresInDays = parseDurationPart(body.expiresInDays, MAX_EXPIRES_DAYS);
  let expiresInHours = parseDurationPart(body.expiresInHours, MAX_EXPIRES_HOURS);
  if (expiresInWeeks + expiresInDays + expiresInHours === 0) {
    expiresInWeeks = DEFAULT_EXPIRES_WEEKS;
  }
  const expiresAt = new Date();
  const extraHours = (expiresInWeeks * 7 + expiresInDays) * 24 + expiresInHours;
  expiresAt.setTime(expiresAt.getTime() + extraHours * 60 * 60 * 1000);

  const interviewId = crypto.randomUUID();
  const publicToken = crypto.randomUUID();
  const roomName = makeRoomName(interviewId);

  let applicationId = applicationIdRaw;
  let applicationCandidateName = candidateName;
  let applicationCandidateEmail = candidateEmail;
  let applicationRecord: {
    candidateName: string | null;
    candidateEmail: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null = null;
  let round = 1;

  if (applicationId) {
    const application = await prisma.application.findFirst({
      where: { applicationId, orgId }
    });
    if (!application) {
      return NextResponse.json({ error: "APPLICATION_NOT_FOUND" }, { status: 404 });
    }
    applicationCandidateName = application.candidateName ?? null;
    applicationCandidateEmail = application.candidateEmail ?? null;
    applicationRecord = {
      candidateName: application.candidateName ?? null,
      candidateEmail: application.candidateEmail ?? null,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt
    };
    const maxRound = await prisma.interview.aggregate({
      where: { applicationId },
      _max: { round: true }
    });
    round = roundOverride ?? (maxRound._max.round ?? 0) + 1;
  } else {
    applicationId = crypto.randomUUID();
    const created = await prisma.application.create({
      data: {
        applicationId,
        orgId,
        candidateName: applicationCandidateName,
        candidateEmail: applicationCandidateEmail
      }
    });
    applicationRecord = {
      candidateName: created.candidateName ?? null,
      candidateEmail: created.candidateEmail ?? null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  }

  const interview = await prisma.interview.create({
    data: {
      interviewId,
      publicToken,
      orgId,
      applicationId,
      roomName,
      durationSec,
      round,
      candidateIdentity: makeCandidateIdentity(interviewId),
      interviewPrompt: prompt,
      agentName: body.agentName ?? env.agentName,
      expiresAt
    }
  });

  const url = `${env.baseUrl}/interview/${interview.publicToken ?? interview.interviewId}`;
  return NextResponse.json({
    interviewId: interview.interviewId,
    applicationId,
    round: interview.round,
    roomName,
    url,
    candidateName: applicationCandidateName ?? null,
    candidateEmail: applicationCandidateEmail ?? null,
    expiresAt: interview.expiresAt?.toISOString() ?? null,
    interviewCreatedAt: interview.createdAt.toISOString(),
    applicationCreatedAt: applicationRecord?.createdAt.toISOString() ?? null,
    applicationUpdatedAt: applicationRecord?.updatedAt.toISOString() ?? null,
    durationSec: interview.durationSec,
    prompt: interview.interviewPrompt ?? null
  });
}
