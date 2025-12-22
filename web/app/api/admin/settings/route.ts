import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_EXPIRES_WEEKS = 4;
const MAX_EXPIRES_DAYS = 6;
const MAX_EXPIRES_HOURS = 23;
const DEFAULT_EXPIRES_WEEKS = 1;
const DEFAULT_DURATION_MIN = 10;

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
  return Math.min(30, Math.max(1, normalized));
};

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const settings = await prisma.orgSetting.findUnique({ where: { orgId } });

  return NextResponse.json({
    settings: {
      defaultDurationMin: settings?.defaultDurationMin ?? DEFAULT_DURATION_MIN,
      defaultExpiresWeeks: settings?.defaultExpiresWeeks ?? DEFAULT_EXPIRES_WEEKS,
      defaultExpiresDays: settings?.defaultExpiresDays ?? 0,
      defaultExpiresHours: settings?.defaultExpiresHours ?? 0
    }
  });
}

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const defaultDurationMin = normalizeDurationMin(body.defaultDurationMin);

  let defaultExpiresWeeks = parseDurationPart(body.defaultExpiresWeeks, MAX_EXPIRES_WEEKS);
  let defaultExpiresDays = parseDurationPart(body.defaultExpiresDays, MAX_EXPIRES_DAYS);
  let defaultExpiresHours = parseDurationPart(body.defaultExpiresHours, MAX_EXPIRES_HOURS);
  if (defaultExpiresWeeks + defaultExpiresDays + defaultExpiresHours === 0) {
    defaultExpiresWeeks = DEFAULT_EXPIRES_WEEKS;
  }

  const settings = await prisma.orgSetting.upsert({
    where: { orgId },
    create: {
      orgId,
      defaultDurationMin,
      defaultExpiresWeeks,
      defaultExpiresDays,
      defaultExpiresHours
    },
    update: {
      defaultDurationMin,
      defaultExpiresWeeks,
      defaultExpiresDays,
      defaultExpiresHours
    }
  });

  return NextResponse.json({
    settings: {
      defaultDurationMin: settings.defaultDurationMin,
      defaultExpiresWeeks: settings.defaultExpiresWeeks,
      defaultExpiresDays: settings.defaultExpiresDays,
      defaultExpiresHours: settings.defaultExpiresHours
    }
  });
}
