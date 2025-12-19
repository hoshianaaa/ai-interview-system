# 終了処理の強化案

## 1. Webhookでの自動終了（participant_left / participant_disconnected）

### 実装案
- `web/app/api/interview/webhook/route.ts` で `participant_left` / `participant_disconnected` をハンドリング
- 候補者の `participantIdentity === interview.candidateIdentity` を条件に終了処理を実行
- 既存の `/api/interview/end` を呼ぶのではなく、内部で同等の終了ロジックを実行
  - 例: `status` を `ending` に更新 → `egress.stopEgress` → `room.deleteRoom` → `status` を `completed`
- 多重実行を避けるため、`status` が `ending` / `completed` の場合は即return

### 効果
- ブラウザが強制終了された場合でもサーバ側で終了処理が走る
- フロント依存が減り、録画停止・部屋削除が安定する

### 現状の課題
- WebhookはLiveKitからのイベント到達に依存するため、Webhook未達時は補足できない
- 候補者がネットワーク切断した場合に `participant_left` が遅延/不発となるケースがある

## 2. サーバ側TTLによる自動終了

### 実装案
- `Interview` テーブルに「最終更新時刻」や「候補者最終アクティブ時刻」を持たせる
  - 例: `lastActiveAt` を `participant_joined`/`participant_connected` などで更新
- 定期ジョブで `lastActiveAt` が一定時間超過の面接を `ending` → `completed` へ移行
  - Next.js単体の場合はCron（外部）+ APIエンドポイント
  - もしくはDB/QueueのScheduled Job
- TTL条件例: `candidateJoinedAt` がある && `lastActiveAt` が10分以上更新されていない

### 効果
- Webhook未達やブラウザ終了失敗でも、一定時間で終了処理が保証される
- 実運用での「ぶら下がり」面接の蓄積を防げる

### 現状の課題
- 定期ジョブ基盤が必要（Vercel/Cloud Runなど実行環境に合わせた実装が必要）
- TTL判定のしきい値を誤ると、通信断の一時的な揺らぎで誤終了のリスクがある

## 3. 終了失敗時の再送・ステータス監視

### 実装案
- `/api/interview/end` で `failed` ステータスを明示的に設定
  - `egress.stopEgress` や `room.deleteRoom` の失敗時に `failed` を記録
- フロントで `status` をポーリング or SSE で監視
  - `ending` が一定時間続く場合は「再実行」ボタンを表示
- 再実行ボタンは `/api/interview/end` を再送し、正常化を試みる

### 効果
- 失敗が可視化され、オペレーションやユーザー対応がしやすくなる
- 一時的なLiveKitエラーで終了が止まっても復旧できる

### 現状の課題
- `failed` の定義・再実行可能条件を明確化する必要がある
- UI/UXの追加実装（監視表示・再実行ボタン）が必要
