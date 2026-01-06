# 3. 概念モデル（最小エンティティ）

## Candidate（応募者）

- id
- 氏名（name）
- メール（email）※重複チェック
- メモ（memo 任意）
- 作成日時（createdAt）

## Job（求人）

- id
- 求人名（title）
- 有効/無効（isActive）

## Application（応募）※主役
- id
- candidateId
- jobId
- currentStage：1st / 2nd（将来拡張可）
- overallDecision：Undecided / Pass / Fail / Hold
//今は不要 - 担当者（assignee 任意：userId）
- updatedAt

## InterviewSession（面接1回）

- id
- applicationId
- stage：1st / 2nd
- progressStatus：Scheduled / Completed / NoShow / Failed
- decision：Undecided / Pass / Fail / Hold
//今は不要 - score：number（0–100想定、null可）
- recordingUrl（任意）
- transcriptUrl or transcriptText（任意）
- startedAt / endedAt（任意）
- inviteUrl（面接用URL）

# 4. ステータス定義

## progressStatus（面接の進行）

- Scheduled(実施待ち)：リンク発行済み / 実施前
- Completed(完了)：面接が完了（提出済み）
- NoShow(未参加)：期限内に実施されなかった（手動で付与でもOK）
- Failed(失敗（エラー）)：技術的に無効（録画取れない等）

## decision（面接の判定）

- Undecided：未判定
- Pass：通過
- Fail：不合格
- Hold：保留

## overallDecision（応募全体の判定）

- Undecided / Pass / Fail / Hold

## stage（面接回）

- 1st：一次面接
- 2nd：二次面接
- （将来）final：最終面接

# 5. 組織別の料金・面接時間枠（サブスク）

## 目的

- 組織ごとにプランと月次サイクルを持ち、面接時間を「月額枠 + 超過課金」で管理する。

## 定義

- `OrgSubscription.plan`：加入プラン（例：starter）。
- `OrgSubscription.billingAnchorAt`：加入日（決済日）の基準日時。
- `OrgSubscription.cycleStartedAt` / `cycleEndsAt`：現在の課金サイクル。
- `OrgSubscription.usedSec`：サイクル内で確定した使用秒数。
- `OrgSubscription.reservedSec`：発行済みURLで予約中の秒数。
- `OrgSubscription.overageApproved`：超過上限ロック解除フラグ。
- `Interview.quotaReservedSec`：URL発行時に予約した秒数（通常は`durationSec`）。
- `Interview.actualDurationSec`：実際に使用された秒数（`candidateJoinedAt` → `endedAt`、未参加時は0）。
- `Interview.quotaSettledAt`：時間枠の精算が完了した時刻。

## 挙動

- URL発行時に`durationSec`分を予約し、`usedSec + reservedSec`が「月次枠 + 超過上限」を超える場合は発行不可。
- 面接終了時に実使用時間を算出し、`usedSec`へ加算、`reservedSec`から差分を精算。
- サイクル更新時に`usedSec`/`reservedSec`をリセット（未使用分の繰り越しなし）。

## プラン

- スターター：月額3,000円 / 100分
- 超過：30円/分、初期上限は3,000円（100分）。上限到達時は管理者承認が必要。

## 管理者画面・API

- システム管理者が`/super-admin`で組織のプラン設定と超過承認を管理。
- 組織管理者はプラン情報と利用状況を閲覧のみ。
- APIは`/api/super-admin/org-quotas`でプラン設定/超過承認を行う。
