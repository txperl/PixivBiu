import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/dl/", "PLUGIN")
class DoDownload(interRoot):
    def __init__(self):
        self.code = 1

    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("dl", ["kt", "workID=none", "data=none"], "POST")
        except:
            return {"code": 0, "msg": "missing parameters"}

        if args["fun"]["workID"] == "none" and args["fun"]["data"] == "none":
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": self.code,
            "msg": {
                "way": "do",
                "args": args,
                "rst": self.dl(args["ops"], args["fun"].copy()),
            },
        }

    def dl(self, opsArg, funArg):
        if funArg["data"] == "none":
            r = self.CORE.biu.api.illust_detail(funArg["workID"])
            if "illust" not in r:
                self.code = 0
                return "error"
            r = r["illust"]
        else:
            r = json.loads(funArg["data"])

        if r["type"] != "illust" and r["type"] != "manga" and r["type"] != "ugoira":
            self.code = 0
            return "only support illustration, manga and ugoira"

        is_single = len(r["meta_pages"]) == 0

        root_uri = (
            self.CORE.biu.sets["biu"]["download"]["saveURI"]
                .replace("{ROOTPATH}", self.getENV("rootPath"))
                .replace("{HOMEPATH}", os.path.expanduser('~') + "/")
                .replace("{KT}", self.pure_name(funArg["kt"]))
        )
        root_uri = self.format_name(root_uri, r)
        if root_uri[-1] != "/":
            root_uri = root_uri + "/"

        image_save_name = self.pure_name(self.format_name(self.CORE.biu.sets["biu"]["download"]["saveFileName"], r))

        status = []
        if r["type"] != "ugoira" and is_single:
            # 单图下载
            url = r["meta_single_page"]["original_image_url"]
            suf = url.split(".")[-1]
            status.append(
                self.get_download_args(url, folder=root_uri, name=image_save_name, suf=f".{suf}", file_type="file"))
        elif r["type"] != "ugoira" and not is_single:
            # 多图下载
            extra = ""
            file_type = "file"
            url_hash = None
            cache_name = None
            urls = [x["image_urls"]["original"] for x in r["meta_pages"]]
            if self.CORE.biu.sets["biu"]["download"]["autoArchive"]:
                extra = image_save_name + "/"
                file_type = "folder"
                url_hash = self.STATIC.file.md5(StringList=urls)
                cache_name = uuid.uuid1().hex
            for index in range(len(urls)):
                image_url = urls[index]
                suf = image_url.split(".")[-1]
                sign = "-1"
                if self.CORE.biu.sets["biu"]["download"]["autoArchive"]:
                    sign = str(r["id"]) if (index + 1 == len(r["meta_pages"])) else "%not_last%"
                status.append(
                    self.get_download_args(image_url, folder=f"{root_uri}{extra}",
                                           name=f"{image_save_name}_{str(index+1).zfill(len(str(len(urls))))}",
                                           suf=f".{suf}", file_type=file_type, sign=sign, url_hash=url_hash,
                                           cache_name=cache_name)
                )
        else:
            # 动图下载
            zip_url, r_ = self.get_ugoira_download_url(r["id"])
            temp = self.get_download_args(zip_url, folder=f"{root_uri}{image_save_name}/", name="ugoira", suf=".zip",
                                          file_type="folder", sign=str(r["id"]),
                                          callback=self.__callback_convert_ugoira)
            temp["dlArgs"]["@ugoira"] = {
                "r": r_,
                "name": image_save_name
            }
            status.append(temp)

        if self.CORE.dl.add(str(r["id"]), status):
            return "running"
        else:
            return False

    def format_name(self, name, data):
        """
        格式化文件名。
        :param name: 基础文件名模板
        :param data: 图片信息
        :return: 最终文件名
        """
        # 格式化图片时间
        time_zone_local = time.strftime("%z")
        try:
            image_time_local = datetime.strptime(data["create_date"], "%Y-%m-%dT%H:%M:%S%z").astimezone(
                timezone(timedelta(hours=int(time_zone_local[1:3]), minutes=int(time_zone_local[3:5]))))
            image_time_local_str = image_time_local.strftime("%Y-%m-%d")
        except:
            image_time_local_str = "unknown"
        # 格式化现在时间
        now_time_local_str = time.strftime("%Y-%m-%d", time.localtime())
        return (
            name.replace("{title}", self.pure_name(data["title"]))
                .replace("{work_id}", self.pure_name(data["id"]))
                .replace("{user_name}", self.pure_name(data["user"]["name"]))
                .replace("{user_id}", self.pure_name(data["user"]["id"]))
                .replace("{type}", self.pure_name(data["type"]))
                .replace("{date_image}", image_time_local_str)
                .replace("{date_today}", now_time_local_str)
        )

    def get_ugoira_download_url(self, id_):
        """
        获取动图的下载地址。
        :param id_: 动图 id
        :return: url, 动图信息
        """
        try:
            r = self.CORE.biu.api.ugoira_metadata(id_)
            r = r["ugoira_metadata"]
        except:
            return False
        url = r["zip_urls"]["medium"].replace("600x600", "1920x1080")
        return url, r

    def get_download_args(self, url, folder, name, suf="", sign="-1", callback=None, file_type="file", url_hash=None,
                          cache_name=None):
        """
        基于重名文件判断格式化 dler 模块的下载参数。
        :param url: 资源地址
        :param folder: 欲保存至的根目录
        :param name: 欲保存为的文件名称
        :param suf: 文件格式名
        :param sign: 任务组标志，若单任务则为 -1，否则为 dler 任务组 id
        :param callback: 下载完成后的回调函数
        :param file_type: deterPaths@欲哈希检验的文件类型，file 或 folder
        :param url_hash: deterPaths@任务链接的 hash 值
        :param cache_name: deterPaths@缓存文件名，若不传递则为随机 uuid1 值
        :return: 命令参数
        """
        folder = folder.replace("\\\\", "/").replace("\\", "/").replace("//", "/")
        r = {
            "url": url.replace("https://i.pximg.net", self.CORE.biu.pximgURL),
            "folder": folder,
            "name": name + suf,
            "dlArgs": {
                "_headers": {"referer": "https://app-api.pixiv.net/", "user-agent": "PixivBiu Client"},
                "@requests": {"proxies": {"https": self.CORE.biu.proxy}},
                "@aria2": {
                    "referer": "https://app-api.pixiv.net/",
                    "user-agent": "PixivBiu Client",
                    "all-proxy": self.CORE.biu.proxy
                },
                "@others": {"groupSign": sign},
            },
            "callback": [self.__callback_check]
        }
        if callback is not None:
            r["callback"].append(callback)
        if self.CORE.biu.sets["biu"]["download"]["deterPaths"]:
            if url_hash is None:
                url_hash = self.STATIC.file.md5(StringList=[url])
            cache_name = (uuid.uuid1().hex if cache_name is None else cache_name) + ".biu"
            name_extra = url_hash[7:12]
            name_extra2 = f"{url_hash[7:12]}_{str(int(time.time()))}"
            deter_paths = {"type": file_type}
            if file_type == "folder":
                r.update({"folder": "/".join(folder[:-1].split("/")[:-1]) + "/" + cache_name + "/"})
                deter_paths.update({
                    "ori": r["folder"],
                    "dst": folder,
                    "maybe": f"{folder[:-1]}_{name_extra}/",
                    "impossible": f"{folder[:-1]}_{name_extra2}/",
                })
            else:
                r.update({"name": cache_name})
                deter_paths.update({
                    "ori": f"{folder}{r['name']}",
                    "dst": f"{folder}{name}{suf}",
                    "maybe": f"{folder}{name}_{name_extra}{suf}",
                    "impossible": f"{folder}{name}_{name_extra2}{suf}",
                })
            r["dlArgs"].update({"@deterPaths": deter_paths})
            r["callback"].append(self.__callback_deter)
        return r

    def __callback_check(self, this):
        """
        回调函数，暂时仅进行下载失败后的删除操作。
        :param this: 任务对象，回调时传入
        :return: bool
        """
        if self.CORE.dl.modName == "aria2":
            return None
        group_sign = this._dlArgs["@others"]["groupSign"]
        if group_sign == "%not_last%":
            return True
        elif group_sign == "-1":
            if this.status(self.CORE.dl.mod.CODE_BAD):
                self.STATIC.file.rm(this._dlSaveUri)
        else:
            status_arr = ["running"]
            while "running" in status_arr:
                status_arr = self.CORE.dl.status(group_sign)
                time.sleep(0.5)
            if "failed" in status_arr:
                this.status(self.CORE.dl.mod.CODE_BAD, True)
                self.STATIC.file.clearDIR(this._dlSaveDir, nothing=True)
        return True

    def __callback_deter(self, this):
        """
        回调函数，将下载缓存重命名为正式文件名，同时判断是否存在重名文件。
        :param this: 任务对象，回调时传入
        :return: bool
        """
        if not this.status(self.CORE.dl.mod.CODE_GOOD_SUCCESS):
            return None
        if not this._dlSaveUri or (".zip" not in this._dlSaveName and not os.path.exists(this._dlSaveUri)):
            return False
        group_sign = this._dlArgs["@others"]["groupSign"]
        if group_sign == "%not_last%":
            return True
        func_md5 = self.STATIC.file.md5
        func_remove = self.STATIC.file.rm
        if this._dlArgs["@deterPaths"]["type"] == "folder":
            func_md5 = self.STATIC.file.folderMD5
            func_remove = lambda path: self.STATIC.file.clearDIR(path, nothing=True)
        md5_ori = func_md5(this._dlArgs["@deterPaths"]["ori"])
        md5_dst = func_md5(this._dlArgs["@deterPaths"]["dst"])
        if md5_dst is None:
            return self.STATIC.file.rename(this._dlArgs["@deterPaths"]["ori"], this._dlArgs["@deterPaths"]["dst"])
        # 存在同名文件
        if md5_ori == md5_dst:
            return func_remove(this._dlArgs["@deterPaths"]["ori"])
        md5_maybe = func_md5(this._dlArgs["@deterPaths"]["maybe"])
        if md5_maybe is None:
            return self.STATIC.file.rename(this._dlArgs["@deterPaths"]["ori"], this._dlArgs["@deterPaths"]["maybe"])
        if md5_ori == md5_maybe:
            return func_remove(this._dlArgs["@deterPaths"]["ori"])
        return self.STATIC.file.rename(this._dlArgs["@deterPaths"]["ori"], this._dlArgs["@deterPaths"]["impossible"])

    def __callback_convert_ugoira(self, this):
        """
        回调函数，将动图转换至 webp 或 gif。
        :param this: 任务对象，回调时传入
        :return: bool
        """
        if not this.status(self.CORE.dl.mod.CODE_GOOD_SUCCESS):
            return None
        if not this._dlSaveUri or not os.path.exists(this._dlSaveUri):
            return False
        frames = this._dlArgs["@ugoira"]["r"]["frames"]
        pl = []
        dl = []
        for x in frames:
            pl.append(os.path.join(this._dlSaveDir, "./data", x["file"]))
            dl.append(x["delay"])
        self.STATIC.file.unzip(os.path.join(this._dlSaveDir, "./data"), os.path.join(this._dlSaveDir, "ugoira.zip"))
        self.STATIC.file.rm(os.path.join(this._dlSaveDir, "ugoira.zip"))
        name = os.path.join(this._dlSaveDir, this._dlArgs["@ugoira"]["name"])
        if self.CORE.biu.sets["biu"]["download"]["whatsUgoira"] == "gif":
            self.STATIC.file.cov2gif(name + ".gif", pl, dl)
        else:
            self.STATIC.file.cov2webp(name + ".webp", pl, dl)
        return True

    @staticmethod
    def pure_name(name, dest="_"):
        """
        替换文件名中的不允许符号。
        :param name: 文件名
        :param dest: 欲替换成符号
        :return: 最终文件名
        """
        return re.sub(r'[/\\:*?"<>|]', dest, str(name))
