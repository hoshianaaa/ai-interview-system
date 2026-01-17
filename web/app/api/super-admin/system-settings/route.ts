import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId } from "@/lib/super-admin";
import { DEFAULT_CANDIDATE_EMAIL_TEMPLATE } from "@/lib/email-templates";
import {
  DEFAULT_MAX_CONCURRENT_INTERVIEWS,
  SYSTEM_SETTINGS_ID
} from "@/lib/system-settings";

export const runtime = "nodejs";

const parseMaxConcurrent = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const MAX_EMAIL_TEMPLATE = 8000;

const normalizeEmailTemplate = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed;
};

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }
  if (!isSuperAdminOrgId(orgId)) {
    return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 });
  }

  const settings = await prisma.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });
  return NextResponse.json({
    maxConcurrentInterviews:
      settings?.maxConcurrentInterviews ?? DEFAULT_MAX_CONCURRENT_INTERVIEWS,
    candidateEmailTemplate:
      settings?.candidateEmailTemplate ?? DEFAULT_CANDIDATE_EMAIL_TEMPLATE
  });
}

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }
  if (!isSuperAdminOrgId(orgId)) {
    return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const hasMaxConcurrent = "maxConcurrentInterviews" in body;
  const hasEmailTemplate = "candidateEmailTemplate" in body;
  if (!hasMaxConcurrent && !hasEmailTemplate) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const current = await prisma.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });

  let maxConcurrent =
    current?.maxConcurrentInterviews ?? DEFAULT_MAX_CONCURRENT_INTERVIEWS;
  if (hasMaxConcurrent) {
    const parsed = parseMaxConcurrent(body.maxConcurrentInterviews);
    if (parsed === null || !Number.isInteger(parsed)) {
      return NextResponse.json({ error: "INVALID_MAX_CONCURRENT" }, { status: 400 });
    }
    if (parsed < 1 || parsed > 100) {
      return NextResponse.json({ error: "MAX_CONCURRENT_OUT_OF_RANGE" }, { status: 400 });
    }
    maxConcurrent = parsed;
  }

  let candidateEmailTemplate =
    current?.candidateEmailTemplate ?? DEFAULT_CANDIDATE_EMAIL_TEMPLATE;
  if (hasEmailTemplate) {
    const normalized = normalizeEmailTemplate(body.candidateEmailTemplate);
    if (normalized === null) {
      return NextResponse.json({ error: "INVALID_EMAIL_TEMPLATE" }, { status: 400 });
    }
    if (!normalized) {
      return NextResponse.json({ error: "EMAIL_TEMPLATE_REQUIRED" }, { status: 400 });
    }
    if (normalized.length > MAX_EMAIL_TEMPLATE) {
      return NextResponse.json({ error: "EMAIL_TEMPLATE_TOO_LONG" }, { status: 400 });
    }
    candidateEmailTemplate = normalized;
  }

  const updated = await prisma.systemSetting.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {
      maxConcurrentInterviews: maxConcurrent,
      candidateEmailTemplate
    },
    create: {
      id: SYSTEM_SETTINGS_ID,
      maxConcurrentInterviews: maxConcurrent,
      candidateEmailTemplate
    }
  });

  return NextResponse.json({
    maxConcurrentInterviews: updated.maxConcurrentInterviews,
    candidateEmailTemplate:
      updated.candidateEmailTemplate ?? DEFAULT_CANDIDATE_EMAIL_TEMPLATE
  });
}
