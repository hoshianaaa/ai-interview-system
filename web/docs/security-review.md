# セキュリティ評価レポート（組織分離・動画アクセス）

## 範囲と方法
- 対象: `web/app/api/**`, `web/app/**`, `web/src/lib/**`, `web/prisma/schema.prisma`, `web/middleware.ts`, `agent/app.py`, 設定ファイル
- 方法: リポジトリ内の静的コードレビュー
- 未実施: 実運用環境の設定確認、外部サービス（Clerk/LiveKit/Cloudflare）側の権限・ログ確認、動的テスト

## 結論（組織間分離の観点）
- 管理系APIはClerkの`orgId`を用いて絞り込みを実施しており、コード上の明確な組織間漏えいは確認できませんでした。
- ただし、公開URL（`publicToken`/`interviewId`）はベアラートークン扱いのため、URLが漏えいすると他組織からもアクセス・操作が可能です。
- 録画視聴はCloudflare Streamの署名URL設定に依存し、署名必須でない場合は`streamUid`漏えいで閲覧可能です。

## 重要な指摘
### Critical
1) 機密情報がリポジトリにコミットされています  
該当: `web/.env`, `web/.env.local`, `agent/.env.local`  
影響: DB/LiveKit/Cloudflare/Clerkの資格情報が流出すると、他組織を含む全データへの不正アクセスや録画閲覧が可能になります。  
対策: 直ちにキーの無効化・ローテーション、履歴からの削除、`.gitignore`追加、Secrets管理（CI/CDのSecret Manager等）への移行。

### High
2) 公開URLが他組織アクセスの入口になり得ます（ベアラートークン設計）  
該当: `web/app/api/interview/join/route.ts`, `web/app/api/interview/status/route.ts`, `web/app/api/interview/chat/route.ts`, `web/app/api/interview/stream/start/route.ts`, `web/app/api/interview/stream/upload/route.ts`, `web/app/api/interview/end/route.ts`, `web/app/page.tsx`  
影響: URLが漏えいすると他組織ユーザーでも面接参加・チャット投稿・録画アップロード・終了操作が可能です。`publicToken`が無い場合は`interviewId`が公開URLとして使われるため、内部IDが公開面に露出します。  
対策: 公開アクセスは`publicToken`のみに限定し、`interviewId`フォールバックを廃止。失効/再発行フロー・有効期限短縮・アクセスログ・レート制限を導入。

3) 録画視聴URLが署名必須でない場合、`streamUid`漏えいで閲覧可能  
該当: `web/src/lib/stream.ts`, `web/app/api/admin/interview/video/route.ts`, `web/app/api/admin/interview/thumbnail/route.ts`, `web/app/api/admin/interview/download/route.ts`, `web/app/api/interview/stream/upload/route.ts`  
影響: Cloudflare Stream側で`requireSignedURLs`が無効、または署名キー未設定の場合、`streamUid`が分かれば誰でも再生できます。公開APIが`uid`を返すため漏えいリスクがあります。  
対策: Cloudflare Streamの署名URLを必須化し、署名キーを必ず設定。`uid`のクライアント露出を最小化し、短TTLで署名発行、必要なら自前プロキシ経由で配信。

### Medium
4) テナント分離がアプリ実装に依存（DB制約なし・`orgId`がnullable）  
該当: `web/prisma/schema.prisma`  
影響: 将来のAPI追加で`orgId`フィルタを漏らすと組織間漏えいが起きやすい構造です。  
対策: `orgId`を原則NOT NULL化、RLSの導入、Prismaミドルウェアで`orgId`自動付与・自動フィルタリングを徹底。

5) 公開トークンを知る第三者が録画を差し替え可能  
該当: `web/app/api/interview/stream/upload/route.ts`, `web/app/api/interview/stream/start/route.ts`  
影響: 面接完了後でも`streamUid`が上書きされ得るため、録画改ざんリスクがあります。  
対策: 面接状態（`status`/`expiresAt`）チェックを追加し、完了後の再アップロードを拒否。アップロード回数制限と監査ログを追加。

### Low
6) 公開APIにレート制限・監査ログがありません  
該当: `web/app/api/interview/*`  
影響: ブルートフォース/DoSやアクセス追跡の困難さが残ります。  
対策: IP/トークン単位のレート制限、アクセスログ、異常検知の導入。

## 追加確認事項（運用）
- Cloudflare Streamで`requireSignedURLs`が有効か、署名キーが運用環境に設定されているか。
- Clerkの組織管理（特に`SUPER_ADMIN_ORG_ID`のメンバー管理）が厳格に運用されているか。
- 公開URLの発行・アクセス・再発行の監査ログ設計。

## 参考（アクセス制御の現状）
- 認証必須: `/api/admin/**`, `/api/interview/create`, `/api/super-admin/**`（`web/middleware.ts`）
- 公開: `/interview/*`, `/api/interview/*`（ただし`/api/interview/stream/*`は公開ルートに含まれていないため、運用で公開する場合は追加の保護策が必要）
