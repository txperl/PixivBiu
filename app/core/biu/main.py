# coding=utf-8
import json
import os
import re
import sys
import platform
import telnetlib
import threading
from concurrent.futures import ThreadPoolExecutor

import requests
from pixivpy3 import *

from ..file.main import core_module_file as ifile
from ...lib.common.msg import biuMsg
from ...platform import CMDProcessor


@CMDProcessor.core_register_auto("biu", {"config": "{ROOTPATH}config.yml"})
class core_module_biu(object):
    def __init__(self, info=None):
        self.ver = 200010
        self.lowestConfVer = 3
        self.place = "local"
        self.sysPlc = platform.system()
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
        # lib-common 类
        self.msger = biuMsg("PixivBiu")

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
        if self.sets is None:
            self.msger.red("读取配置文件失败，程序无法正常运行")
            input("按任意键退出...")
            sys.exit(0)
        if self.sets["sys"]["confVersion"] < self.lowestConfVer:
            self.msger.red("配置文件版本过低，请使用新版本中的配置文件 (config.yml)")
            input("按任意键退出...")
            sys.exit(0)
        self.apiType = self.sets["sys"]["api"]

    def __preCheck(self):
        """
        进行运行前的检测，目前有如下功能：
        1. 检测端口是否已被占用
        """
        # 检测端口是否被占用
        if CMDProcessor.isPortInUse(self.sets["sys"]["host"].split(":")[1]):
            self.msger.red("现端口已被占用，请修改 config.yml 中 sys-host 配置项")
            input("按任意键退出...")
            sys.exit(0)

    def __getSystemProxy(self):
        """
        检测系统本地设置中的代理地址，并验证是否可用。
        @Windows: 通过注册表项获取
        @macOS: 通过 scutil 获取
        @Linux: 暂时未实现
        """
        if self.sets["biu"]["common"]["proxy"] == "no":
            return ""

        if self.apiType == "byPassSni" or self.sets["biu"]["common"]["proxy"] != "":
            return self.sets["biu"]["common"]["proxy"]

        proxies = []
        cmd = ""

        if self.sysPlc == "Windows":
            cmd = r'reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | ' \
                  r'findstr "ProxyServer AutoConfigURL" '
        elif self.sysPlc == "Darwin":
            cmd = "scutil --proxy"
        else:
            return ""

        # 获取系统 console 执行结果
        cmdRstObj = os.popen(cmd)
        cmdRst = cmdRstObj.read()
        cmdRstObj.close()
        cmdRstArr = cmdRst.split("\n")[:-1]
        proxies = [re.split(r"\s+", x)[1:] for x in cmdRstArr]

        # 筛选出可用代理地址
        for i in range(len(proxies) - 1, -1, -1):
            x = proxies[i]
            if len(x) < 3:
                continue
            add = prt = None

            if self.sysPlc == "Windows":
                tmp = re.match(r"https?:\/\/(.*?):(\d+)", x[2], re.IGNORECASE)
                if tmp is None:
                    continue
                add = tmp.group(1)
                prt = int(tmp.group(2))
            elif self.sysPlc == "Darwin":
                tmp = re.match(r"https?proxy", x[0], re.IGNORECASE)
                if tmp is None:
                    continue
                add = proxies[i][2]
                prt = int(proxies[i - 1][2])

            # 检测本地是否可通
            if add and prt:
                try:
                    telnetlib.Telnet(add, port=prt, timeout=1)
                    url = f"http://{add}:{prt}/"
                    self.msger.msg(f"已启用系统代理地址: {url}")
                    return url
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
            self.msger.red("检测更新失败，可能是目标服务器过长时间未响应")
        elif self.ver < self.biuInfo["version"]:
            self.msger.red(f"有新版本可用@{self.biuInfo['version']}！访问 https://biu.tls.moe/ 即可下载")
            input("按任意键以继续使用旧版本...")

    def __checkNetwork(self):
        """
        检测网络是否可通。若不可通，则启用 bypass 模式。
        """
        self.msger.msg("检测网络状态...")
        try:
            if self.proxy != "":
                requests.get(
                    "https://pixiv.net/", proxies={"https": self.proxy}, timeout=6,
                )
            else:
                requests.get("https://pixiv.net/", timeout=6)
        except:
            self.msger.msg("无法访问 Pixiv，启用 byPassSni API")
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
            self.msger.error(e, header=False)
            self.msger.red("Pixiv 登陆失败")
            input("按任意键退出...")
            sys.exit(0)

    def __loadAccountInfo(self):
        """
        要求用户输入 Pixiv 邮箱、密码信息。
        """
        if (
                self.sets["account"]["username"] == ""
                or self.sets["account"]["password"] == ""
        ):
            self.msger.msg("请输入您 Pixiv 的邮箱、密码 (本程序不会记录)", header=False)
            self.sets["account"]["username"] = input(self.msger.green("邮箱: ", header=False, out=False))
            self.sets["account"]["password"] = input(self.msger.green("密码: ", header=False, out=False))
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

        if token is not None:
            try:
                self.api.auth(refresh_token=token)
                self.apiAssist.auth(refresh_token=token)
                self.msger.msg("使用 Token 登陆")
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

        self.msger.msg(f"{self.apiType} API 登陆成功")

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

        if token is not None:
            try:
                self.api.auth(refresh_token=token)
                self.msger.msg("使用 Token 登陆")
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

        self.msger.msg(f"{self.apiType} API 登陆成功")

        if self.apiType != "app":
            try:
                self.__getPximgTrueIP()
            except:
                self.msger.msg("Pixiv 图片服务器 IP 获取失败")

    def __showRdyInfo(self):
        """
        展示初始化成功消息。
        """
        if self.biuInfo["version"] == -1:
            des = self.msger.red("检测更新失败", header=False, out=False)
        else:
            if self.ver >= int(self.biuInfo["version"]):
                des = "最新"
            else:
                des = self.msger.red(f"有新版本可用@{self.biuInfo['version']}", header=False, out=False)
        self.msger.arr(
            self.msger.msg("初始化完成", out=False),
            "------------",
            self.msger.sign(" PixivBiu ", header=False, out=False),
            "-",
            ("运行",
             "%s (将地址输入现代浏览器即可使用)" % self.msger.green("http://" + self.sets["sys"]["host"], header=False, out=False)),
            ("版本", "%s (%s)" % (self.ver, des)),
            ("API 类型", self.apiType),
            ("图片服务器", self.pximgURL + "/"),
            ("下载保存路径", self.sets["biu"]["download"]["saveURI"].replace("{ROOTPATH}", "程序目录")),
            "-",
            self.msger.sign(" Biu ", header=False, out=False),
            "------------"
        )

    def updateStatus(self, type_, key, c):
        """
        线程池状态更新函数。
        @type_(str): search || download
        @key(str): 线程的唯一 key
        @c(thread): 线程引用
        """
        if not key or c == []:
            return
        self.lock.acquire()
        if type_ == "search":
            self.STATUS["rate_search"][key] = c
        elif type_ == "download":
            self.STATUS["rate_download"][key] = c
        self.lock.release()

    def appWorksPurer(self, da):
        """
        格式化返回的图片信息。
        """
        for i in range(len(da)):
            total = views = 0
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
