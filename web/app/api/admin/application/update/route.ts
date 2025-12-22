import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_CANDIDATE_NAME = 80;
const MAX_CANDIDATE_EMAIL = 254;
const MAX_NOTES_CHARS = 4000;

export async function PATCH(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const applicationId =
    typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const candidateNameRaw =
    typeof body.candidateName === "string" ? body.candidateName.trim() : "";
  const candidateEmailRaw =
    typeof body.candidateEmail === "string" ? body.candidateEmail.trim() : "";
  const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }
  if (candidateNameRaw && candidateNameRaw.length > MAX_CANDIDATE_NAME) {
    return NextResponse.json({ error: "CANDIDATE_NAME_TOO_LONG" }, { status: 400 });
  }
  if (candidateEmailRaw && candidateEmailRaw.length > MAX_CANDIDATE_EMAIL) {
    return NextResponse.json({ error: "CANDIDATE_EMAIL_TOO_LONG" }, { status: 400 });
  }
  if (candidateEmailRaw && !candidateEmailRaw.includes("@")) {
    return NextResponse.json({ error: "CANDIDATE_EMAIL_INVALID" }, { status: 400 });
  }
  if (notesRaw && notesRaw.length > MAX_NOTES_CHARS) {
    return NextResponse.json({ error: "NOTES_TOO_LONG" }, { status: 400 });
  }

  const application = await prisma.application.findFirst({
    where: { applicationId, orgId }
  });
  if (!application) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.application.update({
    where: { applicationId },
    data: {
      candidateName: candidateNameRaw ? candidateNameRaw : null,
      candidateEmail: candidateEmailRaw ? candidateEmailRaw : null,
      applicationNotes: notesRaw ? notesRaw : null
    }
  });

  return NextResponse.json({
    applicationId: updated.applicationId,
    candidateName: updated.candidateName ?? null,
    candidateEmail: updated.candidateEmail ?? null,
    notes: updated.applicationNotes ?? null,
    updatedAt: updated.updatedAt.toISOString()
  });
}
