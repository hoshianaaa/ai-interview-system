import { InterviewStatus } from "@prisma/client";

export type ProgressStatus =
  | "scheduled"
  | "completed"
  | "noShow"
  | "failed"
  | "interrupted"
  | "inProgress";

const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  scheduled: "実施待ち",
  completed: "完了",
  noShow: "未参加",
  failed: "失敗（エラー）",
  interrupted: "途中終了",
  inProgress: "実施中"
};

export function isInterviewExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export function getProgressStatus(
  input: {
    status: InterviewStatus;
    expiresAt: Date | null;
    usedAt: Date | null;
    hasRecording?: boolean | null;
  },
  now: Date = new Date()
): ProgressStatus {
  if (input.status === "failed") return "failed";
  if (
    input.status === "used" ||
    input.status === "recording" ||
    input.status === "ending"
  ) {
    return "inProgress";
  }
  if (input.status === "completed") {
    if (input.usedAt && input.hasRecording === false) return "interrupted";
    return "completed";
  }
  if (isInterviewExpired(input.expiresAt, now) && !input.usedAt) return "noShow";
  return "scheduled";
}

export function getProgressStatusLabel(
  input: {
    status: InterviewStatus;
    expiresAt: Date | null;
    usedAt: Date | null;
    hasRecording?: boolean | null;
  },
  now: Date = new Date()
): string {
  return PROGRESS_STATUS_LABELS[getProgressStatus(input, now)];
}
