import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  buildStreamDownloadToken,
  canSignStreamUrl,
  getStreamDownloads,
  getStreamInfo,
  requestStreamDownload
} from "@/lib/stream";

export const runtime = "nodejs";

const DOWNLOAD_POLL_MS = 1500;

const sanitizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const jsonResponse = (body: Record<string, unknown>, status: number) => {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  return response;
};

export async function GET(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return jsonResponse({ status: "error", message: "ORG_REQUIRED" }, 400);
  }

  const { searchParams } = new URL(req.url);
  const interviewId = searchParams.get("interviewId");

  if (!interviewId) {
    return jsonResponse({ status: "error", message: "interviewId is required" }, 400);
  }

  const interview = await prisma.interview.findFirst({ where: { interviewId, orgId } });
  if (!interview || !interview.streamUid) {
    return jsonResponse({ status: "error", message: "not found" }, 404);
  }

  let requireSigned = false;
  try {
    const info = await getStreamInfo(interview.streamUid);
    requireSigned = Boolean(info.requireSignedURLs);
  } catch (err) {
    console.error("[stream] download setup failed", err);
  }

  if (requireSigned && !canSignStreamUrl()) {
    return jsonResponse({ status: "error", message: "signing key is missing" }, 500);
  }

  let download = null;
  try {
    const downloads = await getStreamDownloads(interview.streamUid);
    download = downloads.default ?? null;
  } catch (err) {
    console.error("[stream] download lookup failed", err);
  }

  if (!download?.url) {
    try {
      const created = await requestStreamDownload(interview.streamUid, "default");
      download = created.default ?? null;
    } catch (err) {
      console.error("[stream] download request failed", err);
    }
  }

  if (!download?.url) {
    return jsonResponse(
      { status: "error", message: "download url unavailable" },
      502
    );
  }

  if (download.status === "error") {
    return jsonResponse({ status: "error", message: "download failed" }, 502);
  }

  if (download.status && download.status !== "ready") {
    return jsonResponse(
      {
        status: "inprogress",
        percentComplete: download.percentComplete ?? null,
        retryAfterMs: DOWNLOAD_POLL_MS
      },
      202
    );
  }

  let finalUrl = download.url;
  if (requireSigned) {
    const token = buildStreamDownloadToken(interview.streamUid);
    if (!token) {
      return jsonResponse(
        { status: "error", message: "signing key is missing" },
        500
      );
    }
    const signedUrl = new URL(finalUrl);
    signedUrl.searchParams.set("token", token);
    finalUrl = signedUrl.toString();
  }

  const filename = sanitizeFilename(`interview-${interviewId}`);
  const namedUrl = new URL(finalUrl);
  namedUrl.searchParams.set("filename", filename);
  return jsonResponse({ status: "ready", url: namedUrl.toString() }, 200);
}
