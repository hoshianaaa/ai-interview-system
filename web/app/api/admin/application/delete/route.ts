import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const applicationId =
    typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const application = await prisma.application.findFirst({
    where: { applicationId, orgId }
  });
  if (!application) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.application.delete({ where: { applicationId } });

  return NextResponse.json({ applicationId: application.applicationId });
}
