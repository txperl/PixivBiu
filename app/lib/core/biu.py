import atexit
import os
import platform
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from pixivpy3 import *

from altfe.interface.root import interRoot
from app.v2.utils.sprint import SPrint

_ln = lambda val, header="PixivBiu": print(f"[{header}] " + val if header else val)


@interRoot.bind("biu", "LIB_CORE")
class CoreBiu(interRoot):
    def __init__(self):
        self.ver = 206040
        self.place = "local"
        self.sysPlc = platform.system()
        self.api_route = "direct"
        self.api = None
        self.sets = self.INS.conf.dict("biu_default")
        self.pximgURL = "https://i.pximg.net"
        self.proxy = ""
        self.biuInfo = None
        self.lang = self.INS.i18n.get_bundle("app.core.biu", func=True)
        # 线程相关
        self.lock = threading.Lock()
        self.pool_srh = ThreadPoolExecutor(
            max_workers=self.sets["biu"]["search"]["maxThreads"]
        )
        self.STATUS = {"rate_search": {}, "rate_download": {}}
        self.auto()

    def auto(self):
        atexit.register(self.__before_exit)
        self.__load_config()  # 加载配置项
        self.__pre_check()  # 运行前检测
        self.biuInfo = self.__get_biu_info()  # 加载联网信息
        try:
            self.__login()  # 登录
        except Exception as e:
            e_str = str(e)
            if e_str != "":
                _ln(e_str)
            input(self.lang("common.press_to_exit"))
            sys.exit(0)
        self.__set_image_host()  # 设置图片服务器地址
        self.__show_ready_info()  # 展示初始化完成信息
        return self

    def __before_exit(self):
        self.pool_srh.shutdown(False)

    def __load_config(self):
        """
        加载 pixivbiu 的全局配置项。
        """
        if len(self.sets) == 0:
            _ln(SPrint.red(self.lang("config.fail_to_load_config")))
            input(self.lang("common.press_to_exit"))
            sys.exit(0)
        self.api_route = self.sets["sys"]["apiRoute"]
        if self.sets["biu"]["download"]["mode"] == "aria2":
            _host = self.sets["biu"]["download"]["aria2Host"]
            if "localhost" not in _host and "127.0.0.1" not in _host:
                self.sets["biu"]["download"]["deterPaths"] = False

    def __pre_check(self):
        """
        进行运行前的检测，目前有如下功能：
        1. 检测端口是否已被占用
        2. 检测 cache 大小
        """
        # 检测端口是否被占用
        if self.STATIC.util.is_prot_in_use(self.sets["sys"]["host"].split(":")[1]):
            _ln(SPrint.red(self.lang("config.hint_port_is_in_use")))
            input(self.lang("common.press_to_exit"))
            sys.exit(0)
        # 检测 Cache 大小
        cache_path = self.getENV("rootPath") + "usr/cache/search/"
        size_cache = self.STATIC.file.get_dir_size_mib(cache_path)
        if size_cache > float(self.sets["biu"]["search"]["maxCacheSizeMiB"]):
            self.STATIC.file.clearDIR(cache_path)

    def __get_biu_info(self):
        """
        获取联网 pixivbiu 相关信息。
        """
        try:
            return requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=6).json()
        except:
            return {
                "version": -1,
                "pApiURL": "public-api.secure.pixiv.net",
                "pPximgRProxyURL": "https://i.pixiv.re",
            }

    def __login(self) -> None | Exception:
        """
        初始化登录函数。
        """
        helper = self.COMMON.loginHelper()

        # Check and set network config
        _ln(self.lang("network.hint_in_check"))
        if (
            helper.check_network(
                is_no_proxy=self.sets["sys"]["proxy"] == "no", is_silent=False
            )
            is False
        ):
            raise Exception(self.lang("login.fail_to_get_token_due_to_network"))

        # Set proxy
        self.proxy = helper.get_proxy()
        _ln(
            (
                f"- {self.lang('config.hint_proxy_in_use')}" % self.proxy
                if self.proxy
                else "- No Proxy"
            ),
            header=None,
        )

        # Set bypass mode
        if helper.is_bypass():
            _ln(SPrint.red(self.lang("network.fail_pixiv_and_use_bypass")))
            self.api_route = "bypassSNI"
            self.proxy = ""

        # Determine refresh token
        access, userid = False, False
        refresh = self.STATIC.file.ain(self.getENV("rootPath") + "usr/.token")
        if not refresh:
            # Guide user to get the initial refresh token manually
            _ln(SPrint.green(self.lang("login.hint_token_only")))
            if input(self.lang("login.is_need_to_get_token")) not in ["y", ""]:
                raise Exception()
            access, refresh, userid = helper.login()

        if not refresh:
            raise Exception(self.lang("login.fail_to_get_token_anyway"))

        # Login and save refresh token
        self.__login_app_api(
            refresh_token=refresh,
            access_token=access if access else None,
            userid=userid if userid else None,
        )
        self.save_token()

    def __login_app_api(
        self,
        refresh_token: str,
        access_token: str | None = None,
        userid: str | None = None,
    ):
        """
        app 模式登录。
        """
        self.api_route = "direct"
        if self.api is None:
            _REQUESTS_KWARGS = {}
            if self.proxy != "":
                _REQUESTS_KWARGS = {
                    "proxies": {"http": self.proxy, "https": self.proxy}
                }
            if self.api_route == "bypassSNI":
                self.api = ByPassSniApi(**_REQUESTS_KWARGS)
                self.api.require_appapi_hosts(hostname=self.biuInfo["pApiURL"])
                self.api.set_accept_language("zh-cn")
            else:
                self.api = AppPixivAPI(**_REQUESTS_KWARGS)
        if userid:
            self.api.user_id = userid
        if access_token:
            self.api.set_auth(access_token=access_token, refresh_token=refresh_token)
        else:
            self.api.auth(refresh_token=refresh_token)
        _ln(f"{self.lang('common.success_to_login')} ({self.api_route.upper()})")

    def __show_ready_info(self):
        """
        展示初始化成功消息。
        """
        self.__clear()
        version_extra = ""
        if self.biuInfo["version"] != -1:
            if self.ver >= int(self.biuInfo["version"]):
                version_extra = self.lang("outdated.hint_latest")
            else:
                version_extra = SPrint.red(
                    f"%s: %s"
                    % (
                        self.lang("outdated.hint_exist_new"),
                        self.format_version(self.biuInfo["version"]),
                    ),
                )
        else:
            version_extra = SPrint.red(
                self.lang("outdated.fail_to_check_duo_to_network")
            )
        print("[PixivBiu] " + self.lang("ready.done_init"))
        print("------------")
        print(SPrint.sign(" PixivBiu "))
        print("-")
        print(
            self.lang("ready.hint_run"),
            "%s (%s)"
            % (
                SPrint.green(
                    "http://" + self.sets["sys"]["host"] + "/",
                ),
                self.lang("ready.hint_how_to_use"),
            ),
        )
        print(
            self.lang("ready.hint_version"),
            "%s (%s)" % (self.format_version(), version_extra),
        )
        print(
            self.lang("ready.hint_function_types"),
            "%s, %s, Proxy@%s"
            % (
                self.api_route,
                self.sets["biu"]["download"]["mode"],
                (
                    self.proxy.replace("http://", "").replace("/", "")
                    if self.proxy
                    else "Off"
                ),
            ),
        )
        print(self.lang("ready.hint_image_service"), self.pximgURL + "/")
        print(
            self.lang("ready.hint_download_path"),
            self.sets["biu"]["download"]["saveURI"].replace(
                "{ROOTPATH}", self.lang("ready.hint_program_path")
            ),
        )
        print("-")
        print(SPrint.sign(" Biu "))
        print("------------")

        # Start token timer
        t = threading.Timer(0, self.__pro_refresh_token)
        t.setDaemon(True)
        t.start()

    def __pro_refresh_token(self):
        """
        子线程，每 30 分钟刷新一次 token 以持久化登录状态。
        :return: none
        """
        while True:
            time.sleep(30 * 60)
            self.update_token()

    def update_token(self):
        ori_access_token = self.api.access_token
        _ln(
            f"{self.lang('others.hint_in_update_token')}: %s"
            % time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time())),
            header=None,
        )
        try:
            self.__login_app_api(refresh_token=self.api.refresh_token)
            self.save_token()
        except Exception as e:
            _ln(SPrint.red(e))
            return False
        return self.api.access_token != ori_access_token

    def save_token(self, refresh_token: str | None = None) -> bool:
        token = refresh_token if refresh_token else self.api.refresh_token
        if token is None:
            return False
        return self.STATIC.file.aout(
            self.getENV("rootPath") + "usr/.token", token, dRename=False
        )

    def update_status(self, type_, key, c):
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

    def app_works_purer(self, da):
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
                "created_time": self.STATIC.util.format_time(
                    c["create_date"], "%Y-%m-%dT%H:%M:%S%z"
                ),
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

    def format_version(self, version=None):
        if version is None:
            version = self.ver
        version = str(version)
        WORDS = "abcdefghij"
        return "2.%s.%s%s" % (
            int(version[1:3]),
            int(version[3:5]),
            WORDS[int(version[-1])],
        )

    def __set_image_host(self):
        """
        设置 pixiv 图片服务器地址。
        """
        if self.sets["biu"]["download"]["imageHost"] != "":
            self.pximgURL = self.sets["biu"]["download"]["imageHost"]
        elif self.api_route == "bypassSNI":
            self.pximgURL = self.biuInfo["pPximgRProxyURL"]

    @staticmethod
    def __clear():
        if os.name == "nt":
            os.system("cls")
        else:
            os.system("clear")
