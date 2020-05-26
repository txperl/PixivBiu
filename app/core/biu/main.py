# coding=utf-8
# pylint: disable=relative-beyond-top-level,unused-wildcard-import
from ...platform import CMDProcessor
from concurrent.futures import ThreadPoolExecutor
from os import system, name
from flask import request
from pixivpy3 import *
import threading
import requests
import sys

if name == "nt":
    import os

    os.system("color")


@CMDProcessor.core_register_auto("biu", {"config": "{ROOTPATH}config.yml"})
class core_module_biu(object):
    def __init__(self, info=None):
        self.ver = 200003
        self.lowestConfVer = 0.1
        self.place = "local"
        self.apiType = "public"
        self.api = None
        self.apiAssist = None
        self.sets = info["config"]
        self.ENVORON = info["ENVIRON"]
        self.pximgURL = "https://i.pximg.net"
        self.lock = threading.Lock()
        self.pool_srh = ThreadPoolExecutor(
            max_workers=info["config"]["biu"]["search"]["maxThreads"]
        )
        self.pool = ThreadPoolExecutor(
            max_workers=info["config"]["biu"]["download"]["maxThreads"]
        )
        self.STATUS = {"rate_search": {}, "rate_download": {}}

    def auto(self):
        self.__prepConfig()  # 加载配置项
        if self.apiType != "byPassSni":
            self.__checkNetwork()  # 检测网络是否可通
        try:
            if self.apiType == "app" or self.apiType == "byPassSni":
                self.__loginAppAPI()
            else:
                self.__loginPublicAPI()
        except:
            input("[pixivbiu] \033[31mPixiv 登陆失败，可能是账号或密码错误\033[0m\n按任意键退出...")
            sys.exit(0)
        return self

    def outSets(self):
        return self.sets

    def __checkNetwork(self):
        print("[pixivbiu] 检测网络状态...")
        try:
            if self.sets["biu"]["common"]["proxy"] != "":
                requests.get(
                    "https://pixiv.net/",
                    proxies={"https": self.sets["biu"]["common"]["proxy"]},
                    timeout=10,
                )
            else:
                requests.get("https://pixiv.net/", timeout=10)
        except:
            print("[pixivbiu] 无法访问 pixiv，启用 byPassSni api")
            self.apiType = "byPassSni"

    def __prepConfig(self):
        if self.sets == None:
            input("[pixivbiu] \033[31m读取配置文件失败，PixivBiu 将无法正常运行\033[0m\n按任意键继续...")
            sys.exit(0)
        if self.sets["sys"]["confVersion"] < self.lowestConfVer:
            input(
                "[pixivbiu] \033[31m配置文件版本过低，请使用新版本中的配置文件（config.yml）\033[0m\n按任意键继续..."
            )
            sys.exit(0)
        if (
            self.sets["account"]["username"] == ""
            or self.sets["account"]["password"] == ""
        ):
            print("[pixivbiu] 请输入 Pixiv 的\033[1;37;45m 邮箱、密码 \033[0m(本程序不会保存与上传)")
            self.sets["account"]["username"] = input("\033[1;37;45m邮箱:\033[0m ")
            self.sets["account"]["password"] = input("\033[1;37;45m密码:\033[0m ")
            self.__clear()
        self.apiType = self.sets["sys"]["api"]

    def __loginPublicAPI(self):
        _REQUESTS_KWARGS = {}
        if self.sets["biu"]["common"]["proxy"] != "":
            _REQUESTS_KWARGS = {
                "proxies": {"https": self.sets["biu"]["common"]["proxy"],},
            }
        self.api = PixivAPI(**_REQUESTS_KWARGS)
        self.apiAssist = AppPixivAPI(**_REQUESTS_KWARGS)
        self.api.login(
            self.sets["account"]["username"], self.sets["account"]["password"]
        )
        self.apiAssist.login(
            self.sets["account"]["username"], self.sets["account"]["password"]
        )
        print("[pixivbiu] %s api 登录成功" % self.apiType)
        self.__showRdyInfo()

    def __loginAppAPI(self):
        _REQUESTS_KWARGS = {}
        if self.sets["biu"]["common"]["proxy"] != "" and self.apiType != "byPassSni":
            _REQUESTS_KWARGS = {
                "proxies": {"https": self.sets["biu"]["common"]["proxy"],},
            }
        if self.apiType == "app":
            self.api = AppPixivAPI(**_REQUESTS_KWARGS)
        else:
            self.api = ByPassSniApi(**_REQUESTS_KWARGS)
            self.api.require_appapi_hosts()
            self.api.set_accept_language("zh-cn")
        self.api.login(
            self.sets["account"]["username"], self.sets["account"]["password"]
        )
        self.apiAssist = self.api
        print("[pixivbiu] %s api 登录成功" % self.apiType)
        if self.apiType != "app":
            try:
                self.__getPximgTrueIP()
            except:
                print("[pixivbiu] Pixiv 图片服务器 IP 获取失败")
        self.__showRdyInfo()

    def __showRdyInfo(self):
        if self.checkForUpdate():
            des = "最新"
        else:
            des = "\033[31m有新版本可用\033[0m"
            print("\033[31m有新版本可用！\033[0m访问 https://biu.tls.moe/ 即可下载")
            input("按任意键继续使用旧版本...")
        print("[pixivbiu] 初始化完成")
        print("------------")
        print("\033[1;37;40m PixivBiu \033[0m")
        print("-")
        print(
            "运行: \033[32mhttp://%s/\033[0m (将地址输入现代浏览器即可使用)" % self.sets["sys"]["host"]
        )
        print("版本: %s (%s)" % (self.ver, des))
        print("API 类型: %s" % self.apiType)
        print("图片服务器: %s/" % self.pximgURL)
        print(
            "下载保存路径: %s"
            % self.sets["biu"]["download"]["saveURI"].replace("{ROOTPATH}", "程序目录/")
        )
        print("-")
        print("\033[1;37;40m Biu \033[0m")
        print("------------")

    def updateStatus(self, type, key, c):
        if not key or c == []:
            return
        self.lock.acquire()
        if type == "search":
            self.STATUS["rate_search"][key] = c
        elif type == "download":
            self.STATUS["rate_download"][key] = c
        self.lock.release()

    def appWorksPurer(self, da):
        for i in range(len(da)):
            total = 0
            typer = "other"
            typea = {
                "illust": "illustration",
                "manga": "manga",
                "ugoira": "ugoira",
            }
            originalPic = None
            tags = []
            c = da[i]
            if c["total_bookmarks"]:
                total = int(c["total_bookmarks"])
            if c["total_view"]:
                views = int(c["total_view"])
            if c["type"] in typea:
                typer = typea[c["type"]]
            for x in c["tags"]:
                tags.append(x["name"])
            if "original_image_url" in c["meta_single_page"]:
                originalPic = c["meta_single_page"]["original_image_url"]
            else:
                originalPic = c["image_urls"]["large"]
            if "is_followed" in c["user"]:
                is_followed = c["user"]["is_followed"] is True
            else:
                is_followed = False
            r = {
                "id": int(c["id"]),
                "type": typer,
                "title": c["title"],
                "caption": c["caption"],
                "created_time": c["create_date"][:10],
                "image_urls": {
                    "small": c["image_urls"]["square_medium"],
                    "medium": c["image_urls"]["medium"],
                    "large": originalPic,
                },
                "is_bookmarked": (c["is_bookmarked"] is True),
                "total_bookmarked": total,
                "total_viewed": views,
                "author": {
                    "id": c["user"]["id"],
                    "account": c["user"]["account"],
                    "name": c["user"]["name"],
                    "is_followed": is_followed,
                },
                "tags": tags,
                "all": c.copy(),
            }
            da[i] = r

    def publicWorksPurer(self, da):
        for i in range(len(da)):
            total = 0
            typer = "other"
            typea = {
                "illustration": "illustration",
                "manga": "manga",
                "ugoira": "ugoira",
            }
            c = da[i]
            if c["stats"]["favorited_count"]["private"]:
                total = total + int(c["stats"]["favorited_count"]["private"])
            if c["stats"]["favorited_count"]["public"]:
                total = total + int(c["stats"]["favorited_count"]["public"])
            if c["stats"]["views_count"]:
                views = int(c["stats"]["views_count"])
            if c["type"] in typea:
                typer = typea[c["type"]]
            r = {
                "id": int(c["id"]),
                "type": typer,
                "title": c["title"],
                "caption": c["caption"],
                "created_time": c["created_time"][:10],
                "image_urls": {
                    "small": c["image_urls"]["px_128x128"],
                    "medium": c["image_urls"]["px_480mw"],
                    "large": c["image_urls"]["large"],
                },
                "is_bookmarked": (c["is_liked"] is True),
                "total_bookmarked": total,
                "total_viewed": views,
                "author": {
                    "id": c["user"]["id"],
                    "account": c["user"]["account"],
                    "name": c["user"]["name"],
                    "is_followed": (c["user"]["is_following"] is True),
                },
                "tags": c["tags"].copy(),
                "all": c.copy(),
            }
            da[i] = r

    def checkForUpdate(self):
        try:
            c = requests.get("https://biu.tls.moe/d/version.txt", timeout=10)
            n = int(c.text)
        except:
            n = self.ver + 1
        return self.ver >= n

    def __getPximgTrueIP(self):
        # 暂时
        self.pximgURL = "https://i.pixiv.cat"
        return

        # url = "https://1.0.0.1/dns-query"
        # params = {
        #     "ct": "application/dns-json",
        #     "name": "i.pximg.net",
        #     "type": "A",
        #     "do": "false",
        #     "cd": "false",
        # }
        # try:
        #     response = requests.get(url, params=params, timeout=6)
        # except:
        #     url = "https://cloudflare-dns.com/dns-query"
        #     try:
        #         response = requests.get(url, params=params, timeout=6)
        #     except:
        #         self.pximgURL = "https://i.pixiv.cat"
        #         return

        # if "data" in response.json()["Answer"][0]:
        #     self.pximgURL = "http://" + response.json()["Answer"][0]["data"]

    def __clear(self):
        if name == "nt":
            system("cls")
        else:
            system("clear")
