# coding=utf-8
import json
import os
import re
import sys
import telnetlib
import threading
from concurrent.futures import ThreadPoolExecutor

import requests
from pixivpy3 import *

from ..file.main import core_module_file as ifile
from ...platform import CMDProcessor

if os.name == "nt":
    os.system("color")


@CMDProcessor.core_register_auto("biu", {"config": "{ROOTPATH}config.yml"})
class core_module_biu(object):
    def __init__(self, info=None):
        self.ver = 200008
        self.lowestConfVer = 3
        self.place = "local"
        self.apiType = "public"
        self.api = None
        self.apiAssist = None
        self.sets = info["config"]
        self.ENVORON = info["ENVIRON"]
        self.pximgURL = "https://i.pximg.net"
        self.proxy = ""
        self.biuInfo = ""
        # 线程相关
        self.lock = threading.Lock()
        self.pool_srh = ThreadPoolExecutor(
            max_workers=info["config"]["biu"]["search"]["maxThreads"]
        )
        self.STATUS = {"rate_search": {}, "rate_download": {}}

    def __del__(self):
        self.pool_srh.shutdown(False)

    def auto(self):
        self.__prepConfig()  # 加载配置项
        self.__preCheck()  # 运行前检测
        self.proxy = self.__getSystemProxy()  # 加载代理地址
        self.biuInfo = self.__getBiuInfo()  # 加载联网信息
        self.__checkForUpdate()  # 检测更新
        if self.apiType != "byPassSni":
            self.__checkNetwork()  # 检测网络是否可通
        self.__login()  # 登录
        self.__showRdyInfo()  # 展示初始化完成信息
        return self

    def __prepConfig(self):
        """
        加载 pixivbiu 的全局配置项
        """
        if self.sets == None:
            input("[pixivbiu] \033[31m读取配置文件失败，PixivBiu 将无法正常运行\033[0m\n按任意键继续...")
            sys.exit(0)
        if self.sets["sys"]["confVersion"] < self.lowestConfVer:
            input(
                "[pixivbiu] \033[31m配置文件版本过低，请使用新版本中的配置文件（config.yml）\033[0m\n按任意键继续..."
            )
            sys.exit(0)
        self.apiType = self.sets["sys"]["api"]

    def __preCheck(self):
        """
        进行运行前的检测，目前有如下功能：
        1. 检测端口是否已被占用
        """
        # 检测端口是否被占用
        if CMDProcessor.isPortInUse(self.sets["sys"]["host"].split(":")[1]):
            print("现端口已被占用，请修改 config.yml 中 sys-host 配置。")
            input("按任意键退出...")
            sys.exit(0)

    def __getSystemProxy(self):
        """
        检测系统本地设置中的代理地址，并验证是否可用。
        @Windows: 通过注册表项获取
        @macOS: 暂时未实现
        @Linux: 暂时未实现
        """
        if self.sets["biu"]["common"]["proxy"] == "no":
            return ""

        if self.apiType == "byPassSni" or self.sets["biu"]["common"]["proxy"] != "":
            return self.sets["biu"]["common"]["proxy"]

        proxies = []

        if os.name == "nt":
            tmp = os.popen(
                'reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | findstr "ProxyServer AutoConfigURL"'
            )
            oriProxy = tmp.read()
            tmp.close()
            t = oriProxy.split("\n")[:-1]
            proxies = [re.split("\s+", x)[1:] for x in t]
        else:
            # MBP 不在身边，之后再更新...（（
            pass

        # 筛选出可用代理地址
        for x in proxies:
            proxy = x[2]
            t = re.match(r"https?:\/\/(.*?):(\d+)", proxy)
            if t:
                try:
                    telnetlib.Telnet(t.group(1), port=int(t.group(2)), timeout=1)
                    print("[pixivbiu] 已启用系统代理地址: %s" % proxy)
                    return proxy
                except:
                    pass

        return ""

    def __getBiuInfo(self):
        """
        获取联网 pixivbiu 相关信息
        """
        try:
            return json.loads(
                requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=6).text
            )
        except:
            return {"version": -1, "pApiURL": "public-api.secure.pixiv.net"}

    def __checkForUpdate(self):
        """
        检测是否有更新（仅本地版本号对比）
        """
        if self.biuInfo["version"] == -1:
            print("[pixivbiu] 检测更新失败，可能是目标服务器过长时间未响应。")
        elif self.ver < self.biuInfo["version"]:
            print(
                "\033[31m有新版本可用@%s！\033[0m访问 https://biu.tls.moe/ 即可下载"
                % self.biuInfo["version"]
            )
            input("按任意键以继续使用旧版本...")

    def __checkNetwork(self):
        """
        检测网络是否可通。若不可通，则启用 bypass 模式。
        """
        print("[pixivbiu] 检测网络状态...")
        try:
            if self.proxy != "":
                requests.get(
                    "https://pixiv.net/", proxies={"https": self.proxy}, timeout=6,
                )
            else:
                requests.get("https://pixiv.net/", timeout=6)
        except:
            print("[pixivbiu] 无法访问 pixiv，启用 byPassSni api")
            self.apiType = "byPassSni"
            self.proxy = ""

    def __login(self):
        """
        登录函数。
        """
        try:
            tokenFile = ifile.ain(self.ENVORON["ROOTPATH"] + "usr/.token.json", )
            if self.sets["account"]["isToken"] and tokenFile:
                args = {
                    "token": tokenFile["token"],
                }
            else:
                self.__loadAccountInfo()
                args = {
                    "username": self.sets["account"]["username"],
                    "password": self.sets["account"]["password"],
                }
            if self.apiType == "app" or self.apiType == "byPassSni":
                self.__loginAppAPI(**args)
            else:
                self.__loginPublicAPI(**args)
        except Exception as e:
            print(e)
            input("[pixivbiu] \033[31mPixiv 登陆失败\033[0m\n按任意键退出...")
            sys.exit(0)

    def __loadAccountInfo(self):
        """
        要求用户输入 Pixiv 邮箱、密码信息。
        """
        if (
                self.sets["account"]["username"] == ""
                or self.sets["account"]["password"] == ""
        ):
            print("[pixivbiu] 请输入 Pixiv 的\033[1;37;45m 邮箱、密码 \033[0m(本程序不会保存与上传)")
            self.sets["account"]["username"] = input("\033[1;37;45m邮箱:\033[0m ")
            self.sets["account"]["password"] = input("\033[1;37;45m密码:\033[0m ")
            self.__clear()
        return self.sets["account"]["username"], self.sets["account"]["password"]

    def __loginPublicAPI(self, username=None, password=None, token=None):
        """
        public 模式登录。
        """
        _REQUESTS_KWARGS = {}
        if self.proxy != "":
            _REQUESTS_KWARGS = {
                "proxies": {"https": self.proxy, },
            }
        self.api = PixivAPI(**_REQUESTS_KWARGS)
        self.apiAssist = AppPixivAPI(**_REQUESTS_KWARGS)

        if token != None:
            try:
                self.api.auth(refresh_token=token)
                self.apiAssist.auth(refresh_token=token)
                print("[pixivbiu] 读取 token 成功")
            except:
                account = self.__loadAccountInfo()
                self.api.login(*account)
                self.apiAssist.login(*account)
        else:
            self.api.login(username, password)
            self.apiAssist.login(username, password)

        if self.sets["account"]["isToken"]:
            ifile.aout(
                self.ENVORON["ROOTPATH"] + "usr/.token.json",
                {"token": self.api.refresh_token, },
                dRename=False,
            )

        print("[pixivbiu] %s api 登录成功" % self.apiType)

    def __loginAppAPI(self, username=None, password=None, token=None):
        """
        app 模式登录。
        """
        _REQUESTS_KWARGS = {}
        if self.proxy != "" and self.apiType != "byPassSni":
            _REQUESTS_KWARGS = {
                "proxies": {"https": self.proxy, },
            }
        if self.apiType == "app":
            self.api = AppPixivAPI(**_REQUESTS_KWARGS)
        else:
            self.api = ByPassSniApi(**_REQUESTS_KWARGS)
            self.api.require_appapi_hosts(hostname=self.biuInfo["pApiURL"])
            self.api.set_accept_language("zh-cn")

        if token != None:
            try:
                self.api.auth(refresh_token=token)
                print("[pixivbiu] 读取 token 成功")
            except:
                account = self.__loadAccountInfo()
                self.api.login(*account)
        else:
            self.api.login(username, password)

        if self.sets["account"]["isToken"]:
            ifile.aout(
                self.ENVORON["ROOTPATH"] + "usr/.token.json",
                {"token": self.api.refresh_token, },
                dRename=False,
            )
        self.apiAssist = self.api
        print("[pixivbiu] %s api 登录成功" % self.apiType)
        if self.apiType != "app":
            try:
                self.__getPximgTrueIP()
            except:
                print("[pixivbiu] Pixiv 图片服务器 IP 获取失败")

    def __showRdyInfo(self):
        """
        展示初始化成功消息。
        """
        if self.biuInfo["version"] == -1:
            des = "\033[31m检测更新失败\033[0m"
        else:
            if self.ver >= self.biuInfo["version"]:
                des = "最新"
            else:
                des = "\033[31m有新版本可用@%s\033[0m" % self.biuInfo["version"]
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
            % self.sets["biu"]["download"]["saveURI"].replace("{ROOTPATH}", "程序目录")
        )
        print("-")
        print("\033[1;37;40m Biu \033[0m")
        print("------------")

    def updateStatus(self, type, key, c):
        """
        线程池状态更新函数。
        @type(str): search || download
        @key(str): 线程的唯一 key
        @c(thread): 线程引用
        """
        if not key or c == []:
            return
        self.lock.acquire()
        if type == "search":
            self.STATUS["rate_search"][key] = c
        elif type == "download":
            self.STATUS["rate_download"][key] = c
        self.lock.release()

    def appWorksPurer(self, da):
        """
        格式化返回的图片信息。
        """
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

    def __getPximgTrueIP(self):
        """
        获取 pixiv 图片服务器地址。
        （现暂时直接返回第三方反代地址）
        """
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
        if os.name == "nt":
            os.system("cls")
        else:
            os.system("clear")
