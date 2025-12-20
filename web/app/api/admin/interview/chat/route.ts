import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const interviewId = searchParams.get("interviewId");

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const interview = await prisma.interview.findFirst({ where: { interviewId, orgId } });
  if (!interview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const messages = await prisma.interviewMessage.findMany({
    where: { interviewId },
    orderBy: { offsetMs: "asc" }
  });

  return NextResponse.json({
    messages: messages.map((msg) => ({
      messageId: msg.messageId,
      role: msg.role,
      text: msg.text,
      offsetMs: msg.offsetMs,
      createdAt: msg.createdAt.toISOString()
    }))
  });
}
