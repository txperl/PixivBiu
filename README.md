# PixivBiu

PixivBiu，一款不错的 Pixiv **辅助**工具。

- [中文](/README.md)
- [English](/docs/README_EN.md)
- [日本語](/docs/README_JA.md)
- [Español](/docs/README_ES.md)

## 基础功能

* Pixiv 搜索，可免会员按收藏数、人气、日期排序
* 下载原始图片，包括插画、漫画、动图
* 多种下载模式，单、多线程模式以及 aria2 支持
* 获取用户的作品、收藏夹、关注列表、推荐等
* 筛选图片的宽高、类型、标签等

## 使用

### 源码

* 安装依赖，执行 `pip install -r requirements.txt`
  + [Flask](https://github.com/pallets/flask)、[requests](https://github.com/psf/requests)、[PyYAML](https://github.com/yaml/pyyaml)、[Pillow](https://github.com/python-pillow/Pillow)、[PixivPy](https://github.com/upbit/pixivpy)、[PySocks](https://github.com/Anorov/PySocks)
* 修改 `./config.yml` 相关配置项，具体可参考[默认配置文件](/app/config/biu_default.yml)
* 执行 `python main.py`
* 访问运行地址，默认为 `http://127.0.0.1:4001/`

### 已编译程序

此项目基于 `Python@3.10(+)` 编写，使用 `PyInstaller` 构建编译版本。

这里提供 Windows、macOS 和 Ubuntu 的编译版本，如有其他需求请自行编译。

具体可在 [GitHub Releases](https://github.com/txperl/PixivBiu/releases) 中下载，或者[在这](https://biu.tls.moe/#/lib/dl)下载。

### Docker

- [Docker_Buildx_PixivBiu](https://github.com/zzcabc/Docker_Buildx_PixivBiu) by [zzcabc](https://github.com/zzcabc)

## 贡献维护

如果你想参与此项目的开发，欢迎查看[开发文档](https://biu.tls.moe/#/develop/quickin)。

## 其他

### 感谢

* [pixivpy](https://github.com/upbit/pixivpy) API 支持
* [pixiv.cat](https://pixiv.cat/) 反代服务器支持
* [HTML5 UP](https://html5up.net/) 前端代码支持

### 条款

* 本程序（PixivBiu）仅供学习交流，最初目的达成后请自行删除
* 使用后任何不可知事件都与原作者无关，原作者不承担任何后果
* [MIT License](https://choosealicense.com/licenses/mit/)
