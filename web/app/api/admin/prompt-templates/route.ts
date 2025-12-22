import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_TEMPLATE_NAME = 80;
const MAX_TEMPLATE_BODY = 4000;

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const templates = await prisma.promptTemplate.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({
    templates: templates.map((row) => ({
      templateId: row.templateId,
      name: row.name,
      body: row.body,
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString()
    }))
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const promptBody = typeof body.body === "string" ? body.body.trim() : "";
  const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : false;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > MAX_TEMPLATE_NAME) {
    return NextResponse.json({ error: "NAME_TOO_LONG" }, { status: 400 });
  }
  if (!promptBody) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (promptBody.length > MAX_TEMPLATE_BODY) {
    return NextResponse.json({ error: "BODY_TOO_LONG" }, { status: 400 });
  }

  const exists = await prisma.promptTemplate.findFirst({ where: { orgId, name } });
  if (exists) {
    return NextResponse.json({ error: "NAME_ALREADY_EXISTS" }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.promptTemplate.updateMany({
        where: { orgId },
        data: { isDefault: false }
      });
    }
    return tx.promptTemplate.create({
      data: {
        templateId: crypto.randomUUID(),
        orgId,
        name,
        body: promptBody,
        isDefault
      }
    });
  });

  return NextResponse.json({
    template: {
      templateId: created.templateId,
      name: created.name,
      body: created.body,
      isDefault: created.isDefault,
      createdAt: created.createdAt.toISOString()
    }
  });
}

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const promptBody = typeof body.body === "string" ? body.body.trim() : "";
  const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : null;

  if (!templateId) {
    return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > MAX_TEMPLATE_NAME) {
    return NextResponse.json({ error: "NAME_TOO_LONG" }, { status: 400 });
  }
  if (!promptBody) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (promptBody.length > MAX_TEMPLATE_BODY) {
    return NextResponse.json({ error: "BODY_TOO_LONG" }, { status: 400 });
  }

  const existing = await prisma.promptTemplate.findFirst({ where: { templateId, orgId } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const duplicate = await prisma.promptTemplate.findFirst({ where: { orgId, name } });
  if (duplicate && duplicate.templateId !== templateId) {
    return NextResponse.json({ error: "NAME_ALREADY_EXISTS" }, { status: 409 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.promptTemplate.updateMany({
        where: { orgId },
        data: { isDefault: false }
      });
      return tx.promptTemplate.update({
        where: { templateId },
        data: { name, body: promptBody, isDefault: true }
      });
    }
    if (isDefault === false) {
      return tx.promptTemplate.update({
        where: { templateId },
        data: { name, body: promptBody, isDefault: false }
      });
    }
    return tx.promptTemplate.update({
      where: { templateId },
      data: { name, body: promptBody }
    });
  });

  return NextResponse.json({
    template: {
      templateId: updated.templateId,
      name: updated.name,
      body: updated.body,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt.toISOString()
    }
  });
}

export async function DELETE(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId) {
    return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  }

  const existing = await prisma.promptTemplate.findFirst({ where: { templateId, orgId } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.promptTemplate.delete({ where: { templateId } });
  return NextResponse.json({ ok: true, templateId });
}
