[中文](README.md) | [English](README_EN.md) | 日本語

# PixivBiu

Pixiv のための便利な補助ツール。

- **閲覧**：本格的なクライアント体験——作品・ユーザー・ランキング、ブックマークやフォローなど
- **絞り込み**：ブックマーク数・閲覧数・タグ・種類などで素早く絞り込み
- **ダウンロード**：オリジナル画質のダウンロード（単一・複数ページ・うごイラ対応）
- **デスクトップ & サーバー**：全プラットフォーム対応、Windows・macOS・Linux 向けパッケージ

## 使い方

1. [Releases](https://github.com/txperl/PixivBiu/releases) からお使いのシステム向けのパッケージをダウンロード
2. 展開して `pixivbiu` を実行
3. ブラウザで [http://127.0.0.1:4001](http://127.0.0.1:4001) を開く

## 設定

機能や利用に関する設定は、設定ページから直接変更できます。

ただし、一部の運用向けの設定項目は、設定ファイルまたは環境変数からのみ変更できます。

よく使う環境変数：

| 変数                              | 用途                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `PIXIVBIU_SERVER_HOST`            | 待ち受けアドレス（既定 `127.0.0.1`、`0.0.0.0` で外部公開） |
| `PIXIVBIU_SERVER_PORT`            | 待ち受けポート（既定 `4001`）                              |
| `PIXIVBIU_LOG_LEVEL`              | ログレベル `debug` / `info` / `warn` / `error`             |
| `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT` | うごイラ出力 `webp` / `gif` / `none`                       |
| `PIXIVBIU_APP_LANGUAGE`           | UI 言語 `auto` / `en` / `zh-CN` / `ja`                     |
| `PIXIVBIU_PIXIV_PROXY`            | プロキシ URL（`scheme://host`、空 = 直結）                 |

設定の詳細は [docs/CONFIGURATION.md](docs/CONFIGURATION.md) を参照してください。

## Development

ビルドと開発には `Go 1.26+`、`bun`、`make` が必要です。

### Build from Source

```bash
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# フロントエンドとバックエンドをビルド
# 生成される bin/pixivbiu はフロントエンド内蔵
make dist

# 実行
./bin/pixivbiu
```

### For Dev

開発時は、まず `make dev` でバックエンドを起動し、続いて `cd frontend && bun run dev` でフロントエンドを起動します。

プロジェクトの構成や実装の詳細は [AGENTS.md](AGENTS.md) を参照してください。

## License

- [MIT](LICENSE)
