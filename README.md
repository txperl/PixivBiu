# PixivBiu

PixivBiu 是一款不错的 Pixiv 搜索**辅助**工具。

## 基础功能

* Pixiv 搜索，并且可免会员按收藏数排序
* 下载原始图片，包括插画、漫画、动图
* 获取用户的作品、收藏夹、关注列表、相关推荐等
* 获取排行榜，包括今日、本周、本月排行等
* 收藏作品、关注等

## 使用

### 源码

* 安装依赖，执行 `pip3 install -r requirements.txt` 
  + [flask](https://github.com/pallets/flask)
  + [requests](https://github.com/psf/requests)
  + [PyYAML](https://github.com/yaml/pyyaml)
  + [Pillow](https://github.com/python-pillow/Pillow)
  + [PixivPy](https://github.com/upbit/pixivpy)
* 修改 `./config.yml` 相关配置选项，具体参见注释，或[配置文档](https://biu.tls.moe/#/usage/quickstart?id=配置)
* 执行 `python3 run.py` 
* 访问运行地址，默认为 `http://127.0.0.1:4001/` 

### 已编译程序

此项目基于 `Python@3.7` 编写，使用 `PyInstaller` 构建编译版本。

我们只提供了 Windows 和 macOS 的编译版本，如有其他需求请自行编译。

具体可在 [Releases](https://github.com/txperl/PixivBiu/releases) 中下载(暂无)，或者[在这](https://biu.tls.moe/#/lib/dl)下载。

## 文档

目前已有**使用、开发**类文档，如有需要请访问 [PixivBiu](https://biu.tls.moe/)。

## 贡献维护

如果你想参与此项目的开发，欢迎查看[开发文档](https://biu.tls.moe/#/develop/quickin)。

## 其他

### 感谢

* [pixivpy](https://github.com/upbit/pixivpy) API 支持
* [pixiv.cat](https://pixiv.cat/) 反代服务器支持
* [HTML5 UP](https://html5up.net/) 前端代码支持

### 条款

* 使用后任何不可知事件都与原作者无关，原作者不承担任何后果
* [MIT License](https://choosealicense.com/licenses/mit/)
