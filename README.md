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

