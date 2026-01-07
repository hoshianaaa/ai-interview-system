import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId } from "@/lib/super-admin";
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
      settings?.maxConcurrentInterviews ?? DEFAULT_MAX_CONCURRENT_INTERVIEWS
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
  const parsed = parseMaxConcurrent(body.maxConcurrentInterviews);
  if (parsed === null || !Number.isInteger(parsed)) {
    return NextResponse.json({ error: "INVALID_MAX_CONCURRENT" }, { status: 400 });
  }
  if (parsed < 1 || parsed > 100) {
    return NextResponse.json({ error: "MAX_CONCURRENT_OUT_OF_RANGE" }, { status: 400 });
  }

  const updated = await prisma.systemSetting.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: { maxConcurrentInterviews: parsed },
    create: { id: SYSTEM_SETTINGS_ID, maxConcurrentInterviews: parsed }
  });

  return NextResponse.json({
    maxConcurrentInterviews: updated.maxConcurrentInterviews
  });
}
