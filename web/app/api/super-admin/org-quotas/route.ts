import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdminOrgId } from "@/lib/super-admin";

export const runtime = "nodejs";

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const parseMinutes = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
};

const normalizeOrgId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }
  if (!isSuperAdminOrgId(orgId)) {
    return NextResponse.json({ error: "SUPER_ADMIN_ONLY" }, { status: 403 });
  }

  const quotas = await prisma.orgQuota.findMany({ orderBy: { orgId: "asc" } });
  return NextResponse.json({
    orgQuotas: quotas.map((row) => ({
      orgId: row.orgId,
      availableSec: row.availableSec,
      updatedAt: row.updatedAt.toISOString()
    }))
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
  const targetOrgId = normalizeOrgId(body.orgId);
  if (!targetOrgId) {
    return NextResponse.json({ error: "ORG_ID_REQUIRED" }, { status: 400 });
  }

  const hasDelta = hasOwn(body, "deltaMinutes");
  const hasAvailable = hasOwn(body, "availableMinutes");
  if (hasDelta === hasAvailable) {
    return NextResponse.json({ error: "INVALID_QUOTA_INPUT" }, { status: 400 });
  }

  if (hasAvailable) {
    const minutes = parseMinutes(body.availableMinutes);
    if (minutes === null) {
      return NextResponse.json({ error: "INVALID_QUOTA_INPUT" }, { status: 400 });
    }
    const nextSec = Math.max(0, minutes) * 60;
    const updated = await prisma.orgQuota.upsert({
      where: { orgId: targetOrgId },
      create: { orgId: targetOrgId, availableSec: nextSec },
      update: { availableSec: nextSec }
    });
    return NextResponse.json({
      orgQuota: {
        orgId: updated.orgId,
        availableSec: updated.availableSec,
        updatedAt: updated.updatedAt.toISOString()
      }
    });
  }

  const deltaMinutes = parseMinutes(body.deltaMinutes);
  if (deltaMinutes === null) {
    return NextResponse.json({ error: "INVALID_QUOTA_INPUT" }, { status: 400 });
  }
  const deltaSec = deltaMinutes * 60;
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.orgQuota.findUnique({ where: { orgId: targetOrgId } });
    const currentSec = current?.availableSec ?? 0;
    const nextSec = Math.max(0, currentSec + deltaSec);
    return tx.orgQuota.upsert({
      where: { orgId: targetOrgId },
      create: { orgId: targetOrgId, availableSec: nextSec },
      update: { availableSec: nextSec }
    });
  });

  return NextResponse.json({
    orgQuota: {
      orgId: updated.orgId,
      availableSec: updated.availableSec,
      updatedAt: updated.updatedAt.toISOString()
    }
  });
}
