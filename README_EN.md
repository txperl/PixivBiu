# PixivBiu

PixivBiu is a nice Pixiv **assistant** tool.

- [中文](./README.md)
- [日本語](./README_JA.md)

## Features

* Pixiv searching, sort by favorites, popularity and date without membership
* Download original images, including illustrations, comics and motion pictures
* Multiple download modes, single and multi-threaded mode and aria2 support
* Get user's works, favorites, followers, recommendations and etc.
* Filter image width, height, type, tags and etc.

## Usage

### Source Code

* Install dependencies, run `pip install -r requirements.txt`
  + [Flask](https://github.com/pallets/flask), [requests](https://github.com/psf/requests), [PyYAML](https://github.com/yaml/pyyaml), [Pillow](https://github.com/python-pillow/Pillow), [PixivPy](https://github.com/upbit/pixivpy), [PySocks](https://github.com/Anorov/PySocks)
* Edit `./config.yml` configuration file, refer to the [default configuration file](./app/config/biu_default.yml)
* Run `python main.py`
* Open the running address, the default is `http://127.0.0.1:4001/`

### Executable Binary File

This project is developed by `Python@3.7(+)` and uses `PyInstaller` to build the executable binary file.

There are only Windows, macOS and Ubuntu version available here, so please build yourself if needed.

They can be downloaded in [GitHub Releases](https://github.com/txperl/PixivBiu/releases), or [here](https://biu.tls.moe/#/lib/dl).

### Docker

- [Docker_Buildx_PixivBiu](https://github.com/zzcabc/Docker_Buildx_PixivBiu) by [zzcabc](https://github.com/zzcabc)

## Contribution

If you want to participate in the development of this project, you are welcome to check [development document](https://biu.tls.moe/#/develop/quickin).

## Other

### Thanks to

* [pixivpy](https://github.com/upbit/pixivpy) API support
* [pixiv.cat](https://pixiv.cat/) Anti-generation server support
* [HTML5 UP](https://html5up.net/) Front-end code support

### Terms

* This program (PixivBiu) is for learning and exchange only, please delete it yourself after the initial purpose is achieved
* Any unknowable event after use has nothing to do with the original author, and the original author will not bear any consequences.
* [MIT License](https://choosealicense.com/licenses/mit/)
