# PixivBiu

PixivBiuはPixivのための**補助的な**ツールです。

- [中文](/README.md)
- [English](/docs/README_EN.md)
- [日本語](/docs/README_JA.md)
- [Español](/docs/README_ES.md)

## 機能

* お気に入り数（会員の除外可）順や人気順でのPixiv検索
* イラスト/漫画/うごイラを含む画像のオリジナル画質でのダウンロード
* シングル/マルチスレッドや [aria2](https://github.com/aria2/aria2) などでのダウンロード
* 指定したユーザの投稿作品/ブックマーク/フォロワー/関連するおすすめなどの取得
* 画像の幅、高さ、タイプ、ラベルなどをフィルタリングします

## 使い方

### ソースコードから

* 依存ライブラリのインストール: `pip install -r requirements.txt`
  * [Flask](https://github.com/pallets/flask), [requests](https://github.com/psf/requests), [PyYAML](https://github.com/yaml/pyyaml), [Pillow](https://github.com/python-pillow/Pillow), [PixivPy](https://github.com/upbit/pixivpy), [PySocks](https://github.com/Anorov/PySocks)
* `./config.yml` の設定（例：[デフォルトの設定ファイル](/app/config/biu_ja.yml)）
* 実行: `python main.py`
* 実行中のページを開く（デフォルトのURL: `http://127.0.0.1:4001/`）

### 実行バイナリから

このプロジェクトは Python 3.10 以上で開発されており、実行バイナリのビルドには `PyInstaller` を使用しています。

Windows 版、macOS 版と Ubuntu 版が利用可能ですが、もし必要であれば自分でビルドを試してください。

ビルド済バイナリは [GitHub Releases](https://github.com/txperl/PixivBiu/releases) もしくは[こちら](https://biu.tls.moe/#/lib/dl)からダウンロードできます。

### Dockerから

- [Docker_Buildx_PixivBiu](https://github.com/zzcabc/Docker_Buildx_PixivBiu) by [zzcabc](https://github.com/zzcabc)

## 貢献

もしこのプロジェクトの開発に参加したいのであれば、お気軽に[開発ドキュメント（中文）](https://biu.tls.moe/#/develop/quickin)をご参照ください。

## その他

### 感謝

* [pixivpy](https://github.com/upbit/pixivpy) APIの提供
* [pixiv.cat](https://pixiv.cat/) Anti-generationのためのサーバの提供
* [HTML5 UP](https://html5up.net/) フロントエンドのコード提供

### 告知事項

* 本プログラム（PixivBiu）は学習と交流のみを目的としておりますので、当初の目的を達成した後は自分で削除してください
* 使用後の如何なる問題も作者には一切関係なく、また作者は一切の責任を負いません
* [MITライセンス](https://choosealicense.com/licenses/mit/)です
