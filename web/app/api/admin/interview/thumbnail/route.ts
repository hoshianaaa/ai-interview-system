import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { buildStreamThumbnailUrl } from "@/lib/stream";

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
  if (!interview || !interview.streamUid) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const thumbnailUrl = buildStreamThumbnailUrl(interview.streamUid);
  return NextResponse.json({ thumbnailUrl });
}
