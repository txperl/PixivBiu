# PixivBiu

PixivBiu, a nice Pixiv **assistant** tool.

- [中文](/README.md)
- [English](/docs/README_EN.md)
- [日本語](/docs/README_JA.md)
- [Español](/docs/README_ES.md)

## Features

* Pixiv search, allows sorting by number of favorites, popularity, and date without membership
* Download original images, including illustrations, comics, and animated GIFs
* Multiple download modes, including single-threaded, multi-threaded, and support for aria2
* Access user's works, collections, following list, recommendations, etc
* Filter images by width, height, type, tags, etc

## Usage

### Source Code

* Install dependencies by executing `pip install -r requirements.txt`
  + [Flask](https://github.com/pallets/flask), [requests](https://github.com/psf/requests), [PyYAML](https://github.com/yaml/pyyaml), [Pillow](https://github.com/python-pillow/Pillow), [PixivPy](https://github.com/upbit/pixivpy), [PySocks](https://github.com/Anorov/PySocks)
* Modify the config items in `./config.yml`, and you can refer to the [default config file](/app/config/biu_en.yml) for details
* Execute `python main.py`
* Access the running address, which is by default `http://127.0.0.1:4001/`.

### Executable Binary File

This project is written in `Python@3.10(+)` and is compiled using `PyInstaller`.

Compiled versions are provided for Windows, macOS, and Ubuntu. If you have other requirements, please compile it yourself.

You can download the specific versions from [GitHub Releases](https://github.com/txperl/PixivBiu/releases) or [here](https://biu.tls.moe/#/lib/dl).

### Docker

- [Docker_Buildx_PixivBiu](https://github.com/zzcabc/Docker_Buildx_PixivBiu) by [zzcabc](https://github.com/zzcabc)

## Contribution

If you want to participate in the development of this project, you are welcome to check [development document](https://biu.tls.moe/#/develop/quickin).

## Other

### Thanks to

* [pixivpy](https://github.com/upbit/pixivpy) API support
* [pixiv.cat](https://pixiv.cat/) Reverse proxy server support
* [HTML5 UP](https://html5up.net/) Front-end code support

### Terms

* This program (PixivBiu) is for learning and exchange purposes only. Please delete it after achieving its initial goal
* The original author is not responsible for any unforeseen events that may occur after use, and does not assume any liability
* [MIT License](https://choosealicense.com/licenses/mit/)
