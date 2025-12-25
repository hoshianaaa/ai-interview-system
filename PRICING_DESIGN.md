# 料金・スケーリング設計 (ドラフト)

目的: 変動費を確実に回収しつつ、乱用とコスト暴走を防ぐ設計方針をまとめる。
備考: 主要単価はユーザー提供の調査値を暫定採用。正式リリース前に必ず検証する。

## 1) 現状のコスト構造
- LiveKit: 通話分数 + 録画(Egress)分数
- STT: 音声分数
- LLM: トークン
- TTS: 文字数(または音声秒)
- R2: 録画サイズ x 保存期間 + 操作回数
- Infra: Vercel / Fly / DB の固定+従量

## 2) 主要サービス単価 (ユーザー提供・要検証)
### LiveKit Cloud
- プラン:
  - Build $0
  - Ship $50
  - Scale $500
  - Enterprise custom
- 従量単価:
  - Agent Session: $0.01 / min
  - WebRTC Participant: $0.00 / min
  - Downstream Data Transfer: $0.15 / GB
  - Ingress / Egress Transcode: $0.02 / min
  - Track Egress: $0.01 / min
- 無料枠 (Build):
  - Agent Session: 1,000 min / month
  - WebRTC Participant: 5,000 min / month
  - Downstream: 50 GB / month
  - Transcode: 60 min / month
- メモ:
  - 1:1面接は agent + candidate の両方が参加者として課金対象
  - 録画(Egress)の有無がコストに大きく影響

### Deepgram (Nova-2)
- Streaming (PAYG): $0.0058 / min
- Batch: $0.0043 / min
- Growth (Streaming): $0.0047 / min
- Add-ons: +$0.0020 / min (Diarization, Redaction)
- メモ:
  - チャネル分離やステレオ入力は実質2倍になる可能性あり

### ElevenLabs (Turbo v2.5)
- クレジット制:
  - Standard: 1 char = 1 credit
  - Turbo/Flash: 1 char = 0.5 credit
- プラン:
  - Free: 10,000 credits
  - Starter: $5 / mo, 30,000 credits
  - Creator: $22 / mo, 100,000 credits, $0.30 / 1k credits
  - Pro: $99 / mo, 500,000 credits, $0.24 / 1k credits
  - Scale: $330 / mo, 2,000,000 credits, $0.18 / 1k credits
  - Business: $1,320 / mo, 11,000,000 credits, $0.12 / 1k credits
- メモ:
  - 日本語は 300 chars/min を目安
  - Turboだと 150 credits/min 程度

### OpenAI GPT-4o
- Input: $2.50 / 1M tokens
- Cached Input: $1.25 / 1M tokens
- Output: $10.00 / 1M tokens
- Batch Input: $1.25 / 1M tokens
- Batch Output: $5.00 / 1M tokens
- メモ:
  - Realtime APIは別単価の可能性あり (例: Input $5 / Output $20)

### Vercel
- Pro: $20 / seat / month (credits included)
- Data Transfer: 1 TB included, $0.15 / GB over
- Function Invocations: $0.60 / 1M over free 1M
- Active CPU Time: 40 hours included, $5 / hour over
- Blob Storage: $0.023 / GB

### Fly.io
- VM (Shared-CPU-1x): ~$1.94 / month (256MB RAM)
- Managed Postgres Basic: $38 / month (1GB RAM)
- Managed Postgres Starter: $72 / month (2GB RAM)
- Volume Storage: $0.15 / GB-month
- Bandwidth Egress (Asia): $0.12 / GB

### Cloudflare R2 (公式ドキュメント)
- Storage: $0.015 / GB-month (Standard)
- Class A Ops: $4.50 / 1M requests
- Class B Ops: $0.36 / 1M requests
- Egress: Free
- Free tier: 10 GB-month, Class A 1M, Class B 10M

## 2.1) 初期おすすめプラン (ユーザー0〜)
- LiveKit: Build
- Deepgram: PAYG streaming
- ElevenLabs: Free または Starter (安定利用なら Creator)
- OpenAI: GPT-4o PAYG
- Vercel: 内部検証は Hobby、公開運用は Pro
- Fly: 共有CPU 1x / 256-512MB を1台
- DB: 最小プラン (Neon free/minimum)
- Storage: R2 free tier
- Region: 日本 (NRT/KIX)

## 2.2) 初期ガードレール (推奨デフォルト)
- 組織あたり同時面接数: 1
- 組織あたり面接数/日: 10
- 面接時間上限: 30分
- 録画: デフォルトON
- 録画品質: 720p
- 録画保持: 7日で自動削除
- 再発行上限: 3回/面接
- レート制限: join/status/chat
- CAPTCHA: join前に必須
- 短命セッショントークン: join/end/chat

## 2.3) 初期の主要リスク
- 同時負荷: ハード上限が無いとCPU/メモリ枯渇
- 録画コスト: Egress分が急増しやすい
- 公開API: join/end/chat/status の悪用
- 外部API制限: STT/TTS/LLM のレート制限や障害
- LLMコスト増: 長い履歴で入力トークン増大
- ストレージ増: 録画/ログが無制限に増える

## 2.4) 初期おすすめ構成の耐久目安
前提:
- Agent VM 1台 (shared-CPU-1x, 256-512MB)
- LiveKit Build
- 録画デフォルトON
- 面接30分

安全目安 (保守的):
- 同時面接: 1
- 面接/日: 約10 (300分)
- 面接/月: 約30 (900分)

補足:
- 録画ONの場合、Transcode無料枠60分は月2面接程度で枯渇
- 2件以上同時が必要ならAgent台数増 + キュー必須

## 3) 料金モデルの候補
- 1回課金: 最も分かりやすい。平均面接時間が安定しているなら有利。
- 分単位課金: 長時間ほど収益化。B2Bで説明しやすい。
- 月額 + 従量: B2B向け。固定収益 + 使い過ぎは課金。
- エンタープライズ: 同時接続数・SLA・保存期間で個別見積。

## 4) リミット設計 (乱用・コスト防止)
- 面接時間上限: 15-30分
- 同時実行数: 1組織あたりN件
- 1日上限: 1組織あたりX回/日
- 録画保持: 7-30日で自動削除
- 再発行: 回数制限
- レート制限: join/status/chat にIP/トークン制限
- CAPTCHA: join前に人間判定

## 5) スケール別の方針 (目安)

### Stage 0: <= 30面接/月 (<= 900 min)
- 料金: 1回課金 or 月額小額
- プラン: LiveKit Build無料枠で運用可能
- 変更: なし (現行の管理型サービスでOK)
- リミット: 時間上限 + 再発行制限

### Stage 1: 30-150面接/月 (900-4,500 min)
- 料金: 1回課金 or 分課金 + 無料枠
- プラン: LiveKit Ship + Vercel Pro + ElevenLabs Creator
- 変更: レート制限 + CAPTCHA導入
- 監視: 面接あたり原価/粗利を計測

### Stage 2: 150-1,000面接/月
- 料金: 月額 + 従量 (超過課金)
- 変更: 録画の低解像度/圧縮/保持期間短縮
- 変更: 同時実行数上限とキュー化

### Stage 3: 1,000面接/月以上
- 料金: エンタープライズ併用
- 変更: LiveKitを自前運用 or 専用プラン検討
- 変更: Agentの水平スケール + 監視強化
- 変更: データ保持と監査ログの分離

## 6) 変更判断のトリガー (例)
- 原価が売上の40%を超える -> 料金/制限/録画設定を見直す
- 同時実行がN件を超える -> キュー + スケール戦略
- 録画保存が月X GBを超える -> 期限短縮 or 有料化
- LLMコストが最大項目 -> トークン削減/要約化/モデル切替

## 7) システム側の修正候補
- 録画: 低解像度化、圧縮、保持期間短縮
- LLM: 低コストモデル、要約生成、プロンプト短縮
- STT/TTS: 低コストモデルへ切替、応答間引き
- API: レート制限 + CAPTCHA + 短命セッショントークン
- 監視: 1面接あたりの分数/トークン/保存サイズを記録

## 8) 原価算出の式
cost_per_interview =
  livekit_room_min * lk_room_rate +
  livekit_egress_min * lk_egress_rate +
  stt_min * stt_rate +
  tts_chars * tts_rate +
  llm_tokens_in * llm_in_rate +
  llm_tokens_out * llm_out_rate +
  r2_gb_month * r2_rate +
  infra_allocated

## 9) 定量シミュレーション (30分, 1:1)
前提:
- 面接時間: 30分
- 発話比率: candidate 15分 / agent 15分
- 日本語発話速度: 300 chars/min
- GPT-4o: 1 char = 1.1 tokens
- LLM context: 平均 3,000 tokens x 20 turns = 60,000 input tokens
- 録画: RoomComposite Egress (720p 30fps)

概算コスト:
- LiveKit Agent Session: 30 min x $0.01 = $0.30
- LiveKit Egress Transcode: 30 min x $0.02 = $0.60
- Deepgram STT: 15 min x $0.0058 = $0.087
- GPT-4o Input: 60,000 / 1M x $2.50 = $0.15
- GPT-4o Output: 4,950 / 1M x $10.00 = $0.0495
- ElevenLabs Turbo: 4,500 chars x 0.5 = 2,250 credits
  - Creator超過単価換算: 2,250 / 1,000 x $0.30 = $0.675
- 合計: 約 $1.87 / セッション (インフラ・保存別)

## 10) 録画サイズと保存コスト
- 720p 30fps 2.5 Mbps: 約18.75 MB/分、30分で約563 MB
- 1080p 30fps 5.0 Mbps: 約37.5 MB/分、30分で約1.13 GB
- 480p 30fps 1.0 Mbps: 約7.5 MB/分、30分で約225 MB
- R2保存コスト例 (720p 30分): 0.563 GB-month x $0.015 ~= $0.0084 / 月

## 11) 調査が必要な情報 (要検証)
- LiveKit Cloud / Deepgram / ElevenLabs / OpenAI の最新単価
- Realtime APIの課金体系 (GPT-4o Realtime)
- 実運用の平均面接時間、発話比率、トークン数
- 録画の平均サイズ、保持期間
- USD/JPY レート
- 実測の同時接続ピークと分布

## 12) 次のアクション
1. 料金情報を検証して原価式を確定
2. 想定ユースケースごとに原価を再試算
3. 価格帯とリミットを決定
4. 監視メトリクスをDBに記録して実測

## 13) サービス化に必要な追加機能
### セキュリティ
- 署名付きトークン: join/end/chat は短命セッション必須にする
- レート制限: IP + トークンで制限、Bot対策
- CAPTCHA: join 前に人間判定
- 監査ログ: 誰がいつ面接URLを発行/削除したか
- 権限分離: 管理者 / メンバー / 閲覧のみ

### カウント(課金の根拠)
- 面接回数
- 面接分数 (room/egress)
- 音声分数(STT)
- LLM入出力トークン
- TTS文字数/音声秒
- 録画サイズと保存日数

## 14) 運用(人の手当て)
- 請求運用: 初期は請求書 + 銀行振込でOK (B2B向け)
- 決済移行: 税金/手数料/返金フローを整備してカード決済へ
- サポート: URL再発行、録画削除、権限管理の窓口
- 不正/異常検知: 連続発行や短時間大量アクセスの警告

## 15) 料金回収フローの例
- MVP: 請求書PDF + 銀行振込 (月末締め翌月払い)
- 成長期: クレカ自動課金 + 超過分従量
- 企業向け: 年払い + SLA + 監査ログ提供

## 16) ユーザー数別のおすすめ構成・耐久・費用・料金体系 (録画ON/円換算)
前提:
- USD/JPY = 150
- 1面接30分、録画はデフォルトON
- Agent 1台 = 同時1件を基本
- 変動費は「面接単価 x 面接回数」で計算
- 面接単価の目安: 録画ON $1.9/件 -> 約285円/件
- 利益試算は「月間面接数(目安)の上限」で計算
- 料金例は「1回課金(30分/録画込)」で統一

| ユーザー数(目安) | 月間面接数(目安) | おすすめ構成 | 主なプラン費用(円/月) | 安全な同時数 | 想定料金体系(円) | 月間売上(円) | 月間総コスト(円) | 月間利益(円) / 利益率 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0〜5 | 〜30 | LiveKit Build / Vercel Hobby(内部) or Pro(公開) / Agent 1台 / DB最小 | LiveKit 0 / Vercel 0-3,000 / Fly 300 / ElevenLabs 0-750 / DB 0 | 1 | 1回 1,000円 | 30,000 | 4,000 + 285×30 = 12,550 | 17,450 / 58% |
| 5〜30 | 30〜150 | LiveKit Ship / Vercel Pro / Agent 1〜2台 / DB Basic | LiveKit 7,500 / Vercel 3,000 / ElevenLabs 3,300 / DB 5,700 / Fly 300-600 | 1〜2 | 1回 900円 | 135,000 | 20,000 + 285×150 = 62,750 | 72,250 / 54% |
| 30〜200 | 150〜1,000 | LiveKit Scale / Agent 3〜8台 / DB Starter | LiveKit 75,000 / Vercel 3,000 / ElevenLabs 15,000-50,000 / DB 10,800 / Fly 900-2,400 | 3〜8 | 1回 800円 | 800,000 | 120,000 + 285×1,000 = 405,000 | 395,000 / 49% |
| 200+ | 1,000+ | Enterprise or 自前運用 / 専用監視 | Enterprise/個別 | 10+ | 年額 + SLA + 従量 | 個別見積 | 個別見積 | 目標粗利60% |

補足:
- 価格下限の考え方: 1件あたり (固定費/月 ÷ 月間面接数) + 変動費
- 目標粗利をRとする場合: 目安価格 = 価格下限 ÷ (1 - R)
- 固定費は主なプラン費用の中間値を丸めて試算
- 録画ON時はEgress課金が主コストになり、無料枠はすぐ枯渇する
- 2件以上の同時利用が必要ならAgent台数を増やし、キュー制御が必須
- 料金の簡素化を優先するなら「1回課金 + 面接時間固定」が最も説明しやすい

## 16.1) 分単位課金モデルの具体例 (月額3,000円, 録画ON前提)
前提:
- USD/JPY = 150
- 録画ONの原価: $1.9 / 30分 -> 約9.5円/分

提案プラン例:
- 月額3,000円 (録画ON) / 120分まで含む
- 超過: 20円/分

粗利の試算:
| 利用ケース | 売上 | 変動費 | 粗利 | 粗利率 |
| --- | --- | --- | --- | --- |
| 120分 (録画ON) | 3,000円 | 1,140円 | 1,860円 | 62% |
| 300分 (録画ON) | 6,600円 | 2,850円 | 3,750円 | 57% |

補足:
- 価格下限の目安 = (固定費/月 ÷ 月間面接数) + 変動費
- 目標粗利率Rのとき: 価格下限 ÷ (1 - R)
- 上の粗利は変動費のみ (固定費は別途)
- 目標粗利70%を狙うなら、含有分数を減らすか超過単価を上げる
- 実測の分数/トークン/録画サイズで再試算すること
