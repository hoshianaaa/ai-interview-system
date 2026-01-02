# Usage

このドキュメントは、面接の具体的な実施手順を簡潔にまとめたものです。

## 前提

- Webアプリが起動している（例: `npm run dev`）
- 環境変数が設定済み（LiveKit / DB / Cloudflare Stream など）

## 手順

1) 面接URLを発行する

```
curl -X POST http://localhost:3000/api/interview/create
```

レスポンス例:

```
{
  "interviewId": "xxxx",
  "roomName": "ivw_xxxx",
  "url": "http://localhost:3000/interview/xxxx"
}
```

2) 候補者にURLを共有し、アクセスしてもらう

- 候補者が `url` を開くと `join` が実行され、面接が開始されます。
- 1 URL = 1 回のみ（再入室不可）。

3) 面接を終了する

- 画面の終了ボタン、またはタイマーで終了します。
- 手動で終了する場合は以下を実行:

```
curl -X POST http://localhost:3000/api/interview/end \
  -H "Content-Type: application/json" \
  -d '{"interviewId":"xxxx"}'
```

4) 録画を確認する

- 録画ファイル（候補者映像 + 候補者音声 + Agent音声）は Cloudflare Stream に保存されます。
- video uid は DB の `streamUid` に格納されます。

## 参考

- 実装の詳細: `docs/dev1.md`
- API/画面の流れ: `docs/dev2.md`
