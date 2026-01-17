import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CANDIDATE_EMAIL_TEMPLATE } from "@/lib/email-templates";
import { SYSTEM_SETTINGS_ID } from "@/lib/system-settings";

export const runtime = "nodejs";

const MAX_EXPIRES_WEEKS = 4;
const MAX_EXPIRES_DAYS = 6;
const MAX_EXPIRES_HOURS = 23;
const DEFAULT_EXPIRES_WEEKS = 1;
const MAX_DURATION_MIN = 10;
const DEFAULT_DURATION_MIN = 10;
const MAX_EMAIL_TEMPLATE = 8000;

const parseDurationPart = (value: unknown, max: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const normalized = Math.floor(num);
  return Math.min(max, Math.max(0, normalized));
};

const normalizeDurationMin = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_DURATION_MIN;
  const normalized = Math.floor(num);
  return Math.min(MAX_DURATION_MIN, Math.max(1, normalized));
};

const normalizeEmailTemplate = (value: unknown) => {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const settings = await prisma.orgSetting.findUnique({ where: { orgId } });
  const systemSettings = await prisma.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });

  const defaultDurationMin = Math.min(
    MAX_DURATION_MIN,
    Math.max(1, settings?.defaultDurationMin ?? DEFAULT_DURATION_MIN)
  );

  return NextResponse.json({
    settings: {
      defaultDurationMin,
      defaultExpiresWeeks: settings?.defaultExpiresWeeks ?? DEFAULT_EXPIRES_WEEKS,
      defaultExpiresDays: settings?.defaultExpiresDays ?? 0,
      defaultExpiresHours: settings?.defaultExpiresHours ?? 0,
      candidateEmailTemplate: settings?.candidateEmailTemplate ?? null
    },
    systemCandidateEmailTemplate:
      systemSettings?.candidateEmailTemplate ?? DEFAULT_CANDIDATE_EMAIL_TEMPLATE
  });
}

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await prisma.orgSetting.findUnique({ where: { orgId } });

  const hasDuration = "defaultDurationMin" in body;
  const hasExpiresWeeks = "defaultExpiresWeeks" in body;
  const hasExpiresDays = "defaultExpiresDays" in body;
  const hasExpiresHours = "defaultExpiresHours" in body;
  const hasEmailTemplate = "candidateEmailTemplate" in body;
  if (
    !hasDuration &&
    !hasExpiresWeeks &&
    !hasExpiresDays &&
    !hasExpiresHours &&
    !hasEmailTemplate
  ) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  let defaultDurationMin =
    existing?.defaultDurationMin ?? DEFAULT_DURATION_MIN;
  if (hasDuration) {
    defaultDurationMin = normalizeDurationMin(body.defaultDurationMin);
  }

  let defaultExpiresWeeks =
    existing?.defaultExpiresWeeks ?? DEFAULT_EXPIRES_WEEKS;
  let defaultExpiresDays = existing?.defaultExpiresDays ?? 0;
  let defaultExpiresHours = existing?.defaultExpiresHours ?? 0;

  if (hasExpiresWeeks) {
    defaultExpiresWeeks = parseDurationPart(body.defaultExpiresWeeks, MAX_EXPIRES_WEEKS);
  }
  if (hasExpiresDays) {
    defaultExpiresDays = parseDurationPart(body.defaultExpiresDays, MAX_EXPIRES_DAYS);
  }
  if (hasExpiresHours) {
    defaultExpiresHours = parseDurationPart(body.defaultExpiresHours, MAX_EXPIRES_HOURS);
  }
  if (hasExpiresWeeks || hasExpiresDays || hasExpiresHours) {
    if (defaultExpiresWeeks + defaultExpiresDays + defaultExpiresHours === 0) {
      defaultExpiresWeeks = DEFAULT_EXPIRES_WEEKS;
      defaultExpiresDays = 0;
      defaultExpiresHours = 0;
    }
  }

  let candidateEmailTemplate = existing?.candidateEmailTemplate ?? null;
  if (hasEmailTemplate) {
    const normalized = normalizeEmailTemplate(body.candidateEmailTemplate);
    if (normalized === undefined) {
      return NextResponse.json({ error: "INVALID_EMAIL_TEMPLATE" }, { status: 400 });
    }
    if (normalized && normalized.length > MAX_EMAIL_TEMPLATE) {
      return NextResponse.json({ error: "EMAIL_TEMPLATE_TOO_LONG" }, { status: 400 });
    }
    candidateEmailTemplate = normalized;
  }

  const settings = await prisma.orgSetting.upsert({
    where: { orgId },
    create: {
      orgId,
      defaultDurationMin,
      defaultExpiresWeeks,
      defaultExpiresDays,
      defaultExpiresHours,
      candidateEmailTemplate
    },
    update: {
      defaultDurationMin,
      defaultExpiresWeeks,
      defaultExpiresDays,
      defaultExpiresHours,
      candidateEmailTemplate
    }
  });
  const systemSettings = await prisma.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });

  return NextResponse.json({
    settings: {
      defaultDurationMin: settings.defaultDurationMin,
      defaultExpiresWeeks: settings.defaultExpiresWeeks,
      defaultExpiresDays: settings.defaultExpiresDays,
      defaultExpiresHours: settings.defaultExpiresHours,
      candidateEmailTemplate: settings.candidateEmailTemplate ?? null
    },
    systemCandidateEmailTemplate:
      systemSettings?.candidateEmailTemplate ?? DEFAULT_CANDIDATE_EMAIL_TEMPLATE
  });
}
