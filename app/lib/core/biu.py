import json
import os
import platform
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from pixivpy3 import *

from altfe.interface.root import interRoot


@interRoot.bind("biu", "LIB_CORE")
class core_module_biu(interRoot):
    def __init__(self):
        self.ver = 201010
        self.lowestConfVer = 5
        self.place = "local"
        self.sysPlc = platform.system()
        self.apiType = "public"
        self.api = None
        self.apiAssist = None
        self.sets = self.loadConfig(self.getENV("rootPath") + "config.yml")
        self.pximgURL = "https://i.pximg.net"
        self.proxy = ""
        self.biuInfo = ""
        # 线程相关
        self.lock = threading.Lock()
        self.pool_srh = ThreadPoolExecutor(
            max_workers=self.sets["biu"]["search"]["maxThreads"]
        )
        self.STATUS = {"rate_search": {}, "rate_download": {}}
        # 暂时
        self.sets["account"]["isToken"] = True
        self.sets["account"]["username"] = "1"
        self.sets["account"]["password"] = "1"
        self.auto()

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
        self.__setImageHost()  # 设置图片服务器地址
        self.__showRdyInfo()  # 展示初始化完成信息
        return self

    def __prepConfig(self):
        """
        加载 pixivbiu 的全局配置项。
        """
        if self.sets is None:
            self.STATIC.localMsger.red("读取配置文件失败，程序无法正常运行")
            input("按任意键退出...")
            sys.exit(0)
        if self.sets["sys"]["confVersion"] < self.lowestConfVer:
            self.STATIC.localMsger.red("配置文件版本过低，请使用新版本中的配置文件 (config.yml)")
            input("按任意键退出...")
            sys.exit(0)
        self.apiType = self.sets["sys"]["api"]

    def __preCheck(self):
        """
        进行运行前的检测，目前有如下功能：
        1. 检测端口是否已被占用
        """
        # 检测端口是否被占用
        if self.STATIC.util.isPortInUse(self.sets["sys"]["host"].split(":")[1]):
            self.STATIC.localMsger.red("现端口已被占用，请修改 config.yml 中 sys-host 配置项")
            input("按任意键退出...")
            sys.exit(0)

    def __getSystemProxy(self):
        """
        获取系统代理设置。
        :return:
        """
        if self.sets["biu"]["common"]["proxy"] == "no":
            return ""
        if self.apiType == "byPassSni" or self.sets["biu"]["common"]["proxy"] != "":
            return self.sets["biu"]["common"]["proxy"]

        url = self.STATIC.util.getSystemProxy(self.sysPlc)
        if url != "":
            self.STATIC.localMsger.msg(f"已启用系统代理地址: {url}")

        return url

    def __getBiuInfo(self):
        """
        获取联网 pixivbiu 相关信息。
        """
        try:
            return json.loads(
                requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=6, verify=False).text
            )
        except:
            return {"version": -1, "pApiURL": "public-api.secure.pixiv.net"}

    def __checkForUpdate(self):
        """
        检测是否有更新，仅本地版本号对比。
        """
        if self.biuInfo["version"] == -1:
            self.STATIC.localMsger.red("检测更新失败，可能是目标服务器过长时间未响应")
        elif self.ver < self.biuInfo["version"]:
            self.STATIC.localMsger.red(f"有新版本可用@{self.biuInfo['version']}！访问 https://biu.tls.moe/ 即可下载")
            input("按任意键以继续使用旧版本...")

    def __checkNetwork(self):
        """
        检测网络是否可通。若不可通，则启用 bypass 模式。
        """
        self.STATIC.localMsger.msg("检测网络状态...")
        try:
            if self.proxy != "":
                requests.get(
                    "https://pixiv.net/", proxies={"https": self.proxy}, timeout=3, verify=False
                )
            else:
                requests.get("https://pixiv.net/", timeout=3, verify=False)
        except:
            self.STATIC.localMsger.msg("无法访问 Pixiv，启用 byPassSni API")
            self.apiType = "byPassSni"
            self.proxy = ""

    def __login(self, refreshToken=None, retry=True):
        """
        登录函数。
        """
        try:
            tokenFile = self.STATIC.file.ain(
                self.getENV("rootPath") + "usr/.token.json") if refreshToken is None else {"token": refreshToken}
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
            if retry is False:
                self.STATIC.localMsger.error(e)
                input("按任意键退出...")
                sys.exit(0)
            self.STATIC.localMsger.green("由于 Pixiv 禁止了账号密码登陆方式，暂时只能使用 Token 进行登录")
            if input("是否开始手动获取 Token 后继续使用? (y / n): ") != "y":
                input("按任意键退出...")
                sys.exit(0)
            self.STATIC.localMsger.msg("即将开始进行网络检测，此过程可以减少因网络问题导致的无法正常使用 PixivBiu 的概率", header="Login Helper")
            helper = self.COMMON.loginHelper()
            if helper.check_network() is False:
                self.STATIC.localMsger.red("您的网络无法正常进行 Pixiv Token 登陆，请调整后重试。")
                input("按任意键退出...")
                sys.exit(0)
            token = helper.login()
            if token is False:
                self.STATIC.localMsger.red("获取 Token 时出错，请重试。")
                input("按任意键退出...")
                sys.exit(0)
            self.STATIC.file.aout(
                self.getENV("rootPath") + "usr/.token.json",
                {"token": token, },
                dRename=False,
            )
            self.__login(retry=False)

    def __loadAccountInfo(self):
        """
        要求用户输入 Pixiv 邮箱、密码信息。
        """
        if (
                self.sets["account"]["username"] == ""
                or self.sets["account"]["password"] == ""
        ):
            self.STATIC.localMsger.msg("请输入您 Pixiv 的邮箱、密码 (本程序不会记录)", header=False)
            self.sets["account"]["username"] = input(self.STATIC.localMsger.green("邮箱: ", header=False, out=False))
            self.sets["account"]["password"] = input(self.STATIC.localMsger.green("密码: ", header=False, out=False))
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
            except:
                account = self.__loadAccountInfo()
                self.api.login(*account)
                self.apiAssist.login(*account)
        else:
            self.api.login(username, password)
            self.apiAssist.login(username, password)

        if self.sets["account"]["isToken"]:
            self.STATIC.file.aout(
                self.getENV("rootPath") + "usr/.token.json",
                {"token": self.api.refresh_token, },
                dRename=False,
            )

        self.STATIC.localMsger.msg(f"{self.apiType} API 登陆成功")

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
                # self.STATIC.localMsger.msg("使用 Token 登陆")
            except:
                account = self.__loadAccountInfo()
                self.api.login(*account)
        else:
            self.api.login(username, password)

        if self.sets["account"]["isToken"]:
            self.STATIC.file.aout(
                self.getENV("rootPath") + "usr/.token.json",
                {"token": self.api.refresh_token, },
                dRename=False,
            )
        self.apiAssist = self.api

        self.STATIC.localMsger.msg(f"{self.apiType} API 登陆成功")

    def __showRdyInfo(self):
        """
        展示初始化成功消息。
        """
        if self.biuInfo["version"] == -1:
            des = self.STATIC.localMsger.red("检测更新失败", header=False, out=False)
        else:
            if self.ver >= int(self.biuInfo["version"]):
                des = "最新"
            else:
                des = self.STATIC.localMsger.red(f"有新版本可用@{self.biuInfo['version']}", header=False, out=False)
        WORDS = "abcdefghij"
        version = str(self.ver)
        self.STATIC.localMsger.arr(
            self.STATIC.localMsger.msg("初始化完成", out=False),
            "------------",
            self.STATIC.localMsger.sign(" PixivBiu ", header=False, out=False),
            "-",
            ("运行",
             "%s (将地址输入现代浏览器即可使用)" % self.STATIC.localMsger.green("http://" + self.sets["sys"]["host"] + "/",
                                                                  header=False,
                                                                  out=False)),
            ("版本", "2.%s.%s%s (%s)" % (int(version[1:3]), int(version[3:5]), WORDS[int(version[-1])], des)),
            ("API 类型", self.apiType),
            ("图片服务器", self.pximgURL + "/"),
            ("下载保存路径", self.sets["biu"]["download"]["saveURI"].replace("{ROOTPATH}", "程序目录")),
            "-",
            self.STATIC.localMsger.sign(" Biu ", header=False, out=False),
            "------------"
        )
        t = threading.Timer(60 * 20, self.__pro_refreshToken)
        t.setDaemon(True)
        t.start()

    def __pro_refreshToken(self):
        """
        子线程，每 20 分钟刷新一次 refresh token 并重新登录，以持久化登录状态。
        :return: none
        """
        helper = self.COMMON.loginHelper()
        while True:
            self.STATIC.localMsger.msg(
                "updating token at %s" % time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time())))
            try:
                try:
                    helper.check_network(silent=True, proxy_="")
                except:
                    try:
                        helper.check_network(silent=True, proxy_="auto")
                    except:
                        helper.check_network(silent=True, proxy_=self.proxy)
                token = helper.refresh(refresh_token=self.api.refresh_token)
                if token is not False:
                    self.__login(refreshToken=token)
            except Exception as e:
                self.STATIC.localMsger.error(e, header=False)
            time.sleep(60 * 20)

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

    def __setImageHost(self):
        """
        设置 pixiv 图片服务器地址。
        """
        if self.sets["biu"]["download"]["imageHost"] != "":
            self.pximgURL = self.sets["biu"]["download"]["imageHost"]
        if self.apiType == "byPassSni":
            self.pximgURL = "https://i.pixiv.cat"

    def __clear(self):
        if os.name == "nt":
            os.system("cls")
        else:
            os.system("clear")
