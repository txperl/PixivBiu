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
            .replace("{KT}", funArg["kt"])
        )

        if rootURI[-1] != "/":
            rootURI = rootURI + "/"

        rootURI = self.__fileNameModify(rootURI, r)
        picTitle = self.__fileNameModify(
            self.MOD.biu.sets["biu"]["download"]["saveFileName"], r, True
        )

        status = []

        if r["type"] != "ugoira" and isSingle:
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
            index = 0
            for x in r["meta_pages"]:
                picURL = x["image_urls"]["original"]
                url = picURL.replace("https://i.pximg.net", self.MOD.biu.pximgURL)
                extraURI = (
                    rootURI
                    + picTitle
                    + "/"
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
            extraURI = rootURI + picTitle + "/"
            status.append(
                self.MOD.biu.pool.submit(
                    self.__thread_dlUgoiraPics, r["id"], picTitle, extraURI
                )
            )

        self.MOD.biu.updateStatus("download", str(r["id"]), status)

        return "running"

    def __fileNameModify(self, name, data, isMore=False):
        t = (
            name.replace("{title}", str(data["title"]))
            .replace("{work_id}", str(data["id"]))
            .replace("{user_name}", str(data["user"]["name"]))
            .replace("{user_id}", str(data["user"]["id"]))
            .replace("{type}", str(data["type"]))
        )
        if isMore:
            t = (
                t.replace("\\", "#")
                .replace("/", "#")
                .replace(":", "#")
                .replace("*", "#")
                .replace("?", "#")
                .replace('"', "#")
                .replace("<", "#")
                .replace(">", "#")
                .replace("|", "#")
            )
        return t

    def __thread_dlPics(self, url, uri):
        header = {"Referer": "https://app-api.pixiv.net/"}
        if (
            self.MOD.biu.apiType != "byPassSni"
            and self.MOD.biu.sets["biu"]["common"]["proxy"] != ""
        ):
            proxy = {"https": self.MOD.biu.sets["biu"]["common"]["proxy"]}
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
        if (
            self.MOD.biu.apiType != "byPassSni"
            and self.MOD.biu.sets["biu"]["common"]["proxy"] != ""
        ):
            proxy = {"https": self.MOD.biu.sets["biu"]["common"]["proxy"]}
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
            if self.MOD.biu.sets["biu"]["download"]["whatsUgoira"] == 'gif':
                self.MOD.file.cov2gif(uri + name + ".gif", pl, dl)
            else:
                self.MOD.file.cov2webp(uri + name + ".webp", pl, dl)
        except:
            return False
        return True
