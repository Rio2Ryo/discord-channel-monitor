# Discord Channel Monitor Bot

登録チャンネルの会話停滞を検知し、自動で声かけするDiscordボット。

## 機能
- **自動監視**: 登録チャンネルの最終発言時刻を30秒間隔でチェック
- **状態管理**: 進行中(active) / 停止中(stalled) / 確認待ち(waiting_confirmation)
- **自動声かけ**: 停止中・確認待ちのチャンネルにテンプレートメッセージを送信
- **連投防止**: クールダウン機能（デフォルト10分）

## セットアップ

```bash
npm install
cp .env.example .env
# .env にBOTトークンとギルドIDを設定
node src/index.js
```

## コマンド
| コマンド | 説明 |
|---------|------|
| `/watch #channel [threshold]` | チャンネルを監視対象に追加（閾値: デフォルト180秒） |
| `/unwatch #channel` | 監視解除 |
| `/watchlist` | 監視一覧表示 |
| `/setstatus active\|stalled\|waiting [reason]` | ステータス手動変更 |

## 状態遷移
```
active ──(3分無発言)──→ stalled ──(コマンド)──→ waiting_confirmation
  ↑                        ↑                          │
  └──(誰か発言)────────────┴────(誰か発言/コマンド)───┘
```

## 環境変数
- `DISCORD_TOKEN` — Botトークン
- `GUILD_ID` — 対象ギルドID（省略時グローバルコマンド登録）

## 技術スタック
- discord.js v14
- better-sqlite3
- Node.js
