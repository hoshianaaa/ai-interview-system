# エージェント起動時のポート競合対処

`OSError: [Errno 98] ... address already in use` が出た場合は、対象ポート(例: 8081)を使っている既存プロセスを終了してください。

## 既存プロセスの確認と終了

1. PIDを確認
```bash
lsof -iTCP:8081 -sTCP:LISTEN -n -P
```

2. PIDを終了
```bash
kill <PID>
```

3. まだ残る場合のみ強制終了
```bash
kill -9 <PID>
```

## lsofがない場合の代替
```bash
fuser -n tcp 8081
kill <PID>
```
