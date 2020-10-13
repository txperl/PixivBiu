# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor
import requests
import json


@CMDProcessor.plugin_register("api/biu/do/dl")
class doDownload(object):
    def __init__(self, MOD):
        self.MOD = MOD
        self.code = 1

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("dl", ["kt", "workID=0", "data=0"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        if args["fun"]["workID"] == 0 and args["fun"]["data"] == 0:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": self.code,
            "msg": {
                "way": "do",
                "args": args,
                "rst": self.dl(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def dl(self, opsArg, funArg):
        if funArg["data"] == 0:
            r = self.MOD.biu.apiAssist.illust_detail(funArg["workID"])
            if "illust" not in r:
                self.code = 0
                return "error"
            r = r["illust"]
        else:
            r = json.loads(funArg["data"])

        if r["type"] != "illust" and r["type"] != "manga" and r["type"] != "ugoira":
            self.code = 0
            return "only support illustration, manga and ugoira"

        isSingle = len(r["meta_pages"]) is 0
        rootURI = (
            self.MOD.biu.sets["biu"]["download"]["saveURI"]
            .replace("{ROOTPATH}", self.MOD.ENVIRON["ROOTPATH"])
            .replace("{KT}", self.__pureName(funArg["kt"]))
        )

        if rootURI[-1] != "/":
            rootURI = rootURI + "/"

        rootURI = self.__deName(rootURI, r)
        picTitle = self.__pureName(
            self.__deName(self.MOD.biu.sets["biu"]["download"]["saveFileName"], r)
        )

        status = []

        if r["type"] != "ugoira" and isSingle:
            # 单图下载
            url = r["meta_single_page"]["original_image_url"].replace(
                "https://i.pximg.net", self.MOD.biu.pximgURL
            )
            extraURI = (
                rootURI
                + picTitle
                + "."
                + r["meta_single_page"]["original_image_url"].split(".")[-1]
            )

            status.append(self.MOD.biu.pool.submit(self.__thread_dlPics, url, extraURI))
        elif r["type"] != "ugoira" and not isSingle:
            # 多图下载
            index = 0
            # 判断是否自动归档
            if self.MOD.biu.sets["biu"]["download"]["autoArchive"]:
                ext = picTitle + "/"
            else:
                ext = ""
            for x in r["meta_pages"]:
                picURL = x["image_urls"]["original"]
                url = picURL.replace("https://i.pximg.net", self.MOD.biu.pximgURL)
                extraURI = (
                    rootURI
                    + ext
                    + picTitle
                    + "_"
                    + str(index)
                    + "."
                    + picURL.split(".")[-1]
                )
                index = index + 1

                status.append(
                    self.MOD.biu.pool.submit(self.__thread_dlPics, url, extraURI)
                )
        else:
            # 动图下载
            extraURI = rootURI + picTitle + "/"
            status.append(
                self.MOD.biu.pool.submit(
                    self.__thread_dlUgoiraPics, r["id"], picTitle, extraURI
                )
            )

        self.MOD.biu.updateStatus("download", str(r["id"]), status)

        return "running"

    def __deName(self, name, data):
        return (
            name.replace("{title}", self.__pureName(str(data["title"])))
            .replace("{work_id}", self.__pureName(str(data["id"])))
            .replace("{user_name}", self.__pureName(str(data["user"]["name"])))
            .replace("{user_id}", self.__pureName(str(data["user"]["id"])))
            .replace("{type}", self.__pureName(str(data["type"])))
        )

    def __pureName(self, name):
        return (
            name.replace("\\", "#")
            .replace("/", "#")
            .replace(":", "#")
            .replace("*", "#")
            .replace("?", "#")
            .replace('"', "#")
            .replace("<", "#")
            .replace(">", "#")
            .replace("|", "#")
        )

    def __thread_dlPics(self, url, uri):
        header = {"Referer": "https://app-api.pixiv.net/"}
        if self.MOD.biu.proxy != "":
            proxy = {"https": self.MOD.biu.proxy}
        else:
            proxy = {}

        try:
            imgData = requests.get(url, headers=header, proxies=proxy)
            self.MOD.file.aout(uri, imgData.content, "wb")
        except:
            return False

        return True

    def __thread_dlUgoiraPics(self, id, name, uri):
        header = {"Referer": "https://app-api.pixiv.net/"}
        if self.MOD.biu.proxy != "":
            proxy = {"https": self.MOD.biu.proxy}
        else:
            proxy = {}

        try:
            r = self.MOD.biu.apiAssist.ugoira_metadata(id)
            r = r["ugoira_metadata"]
        except:
            return False

        url = (
            r["zip_urls"]["medium"]
            .replace("600x600", "1920x1080")
            .replace("https://i.pximg.net", self.MOD.biu.pximgURL)
        )
        j = r["frames"]
        pl = []
        dl = []
        for x in j:
            pl.append(uri + "data/" + x["file"])
            dl.append(x["delay"])

        try:
            zipData = requests.get(url, headers=header, proxies=proxy)
            self.MOD.file.aout(uri + "data/ugoira.zip", zipData.content, "wb", False)
            self.MOD.file.unzip(uri + "data/", uri + "data/ugoira.zip")
            self.MOD.file.rm(uri + "data/ugoira.zip")
            if self.MOD.biu.sets["biu"]["download"]["whatsUgoira"] == "gif":
                self.MOD.file.cov2gif(uri + name + ".gif", pl, dl)
            else:
                self.MOD.file.cov2webp(uri + name + ".webp", pl, dl)
        except:
            return False
        return True
