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

# 5. 組織別の面接時間枠

## 目的

- 組織ごとの「残り使用可能時間」を管理し、面接URL発行時に予約、終了時に差分を精算する。

## 定義

- `OrgQuota.availableSec`：組織ごとの残り使用可能時間（秒）。
- `Interview.quotaReservedSec`：URL発行時に予約した秒数（通常は`durationSec`）。
- `Interview.actualDurationSec`：実際に使用された秒数（`candidateJoinedAt` → `endedAt`、未参加時は0）。
- `Interview.quotaSettledAt`：時間枠の精算が完了した時刻。

## 挙動

- URL発行時に`durationSec`分を予約し、`availableSec`から減算。
- 面接終了時に実使用時間を計算し、未使用分を`availableSec`へ返却。
- URL発行前に`availableSec`が不足している場合は発行不可。

## 管理者画面・API

- スーパー管理者のみが`/super-admin`から全組織の時間枠を追加・削除できる。
- APIは`/api/super-admin/org-quotas`を使用（`SUPER_ADMIN_ORG_ID`で制御）。
