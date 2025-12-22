import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publicToken = (searchParams.get("publicToken") ?? "").trim();
  if (!publicToken) {
    return NextResponse.json({ error: "publicToken is required" }, { status: 400 });
  }

  const interview =
    (await prisma.interview.findUnique({ where: { publicToken } })) ??
    (await prisma.interview.findUnique({ where: { interviewId: publicToken } }));

  if (!interview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ status: interview.status });
}
