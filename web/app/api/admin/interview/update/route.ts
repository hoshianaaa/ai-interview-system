import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const candidateNameRaw =
    typeof body.candidateName === "string" ? body.candidateName.trim() : "";
  const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  const interview = await prisma.interview.findFirst({ where: { interviewId, orgId } });
  if (!interview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.interview.update({
    where: { interviewId },
    data: {
      candidateName: candidateNameRaw ? candidateNameRaw : null,
      interviewNotes: notesRaw ? notesRaw : null
    }
  });

  return NextResponse.json({
    interviewId: updated.interviewId,
    candidateName: updated.candidateName ?? null,
    notes: updated.interviewNotes ?? null
  });
}
