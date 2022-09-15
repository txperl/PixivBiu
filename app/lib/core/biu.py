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
class CoreBiu(interRoot):
    def __init__(self):
        self.ver = 205030
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

    def __del__(self):
        self.pool_srh.shutdown(False)

    def auto(self):
        self.__load_config()  # 加载配置项
        self.__pre_check()  # 运行前检测
        self.proxy = self.__get_system_proxy()  # 加载代理地址
        self.biuInfo = self.__get_biu_info()  # 加载联网信息
        self.__check_for_update()  # 检测更新
        if self.api_route != "bypassSNI":
            self.__check_out_network()  # 检测网络是否可通
        self.__login()  # 登录
        self.__set_image_host()  # 设置图片服务器地址
        self.__show_ready_info()  # 展示初始化完成信息
        return self

    def __load_config(self):
        """
        加载 pixivbiu 的全局配置项。
        """
        if len(self.sets) == 0:
            self.STATIC.localMsger.red(self.lang("config.fail_to_load_config"))
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
        """
        # 检测端口是否被占用
        if self.STATIC.util.is_prot_in_use(self.sets["sys"]["host"].split(":")[1]):
            self.STATIC.localMsger.red(self.lang("config.hint_port_is_in_use"))
            input(self.lang("common.press_to_exit"))
            sys.exit(0)

    def __get_system_proxy(self):
        """
        获取系统代理设置。
        :return:
        """
        if self.sets["sys"]["proxy"] == "no":
            return ""
        if self.sets["sys"]["proxy"] != "":
            return self.sets["sys"]["proxy"]
        proxy_address = self.STATIC.util.get_system_proxy(self.sysPlc)
        if proxy_address != "":
            self.STATIC.localMsger.msg(f"{self.lang('config.hint_proxy_in_use')}: {proxy_address}")
        return proxy_address

    def __get_biu_info(self):
        """
        获取联网 pixivbiu 相关信息。
        """
        try:
            return json.loads(requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=6, verify=False).text)
        except:
            return {"version": -1, "pApiURL": "public-api.secure.pixiv.net"}

    def __check_for_update(self):
        """
        检测是否有更新，仅本地版本号对比。
        """
        if self.sets["sys"]["ignoreOutdated"]:
            return
        if self.biuInfo["version"] == -1:
            self.STATIC.localMsger.red(self.lang("outdated.fail_to_check_duo_to_network"))
        elif self.ver < self.biuInfo["version"]:
            self.STATIC.localMsger.red(f"%s@%s! %s." % (
                self.lang("outdated.hint_exist_new"), self.format_version(self.biuInfo["version"]),
                self.lang("outdated.tell_to_download")))
            input(self.lang("outdated.press_to_use_old"))

    def __check_out_network(self):
        """
        检测网络是否可通。若不可通，则启用 bypass 模式。
        """
        self.STATIC.localMsger.msg(self.lang("network.hint_in_check"))
        try:
            if self.proxy != "":
                requests.get(
                    "https://pixiv.net/", proxies={"https": self.proxy}, timeout=3, verify=False
                )
            else:
                requests.get("https://pixiv.net/", timeout=3, verify=False)
        except:
            self.STATIC.localMsger.msg(self.lang("network.fail_pixiv_and_use_bypass"))
            self.api_route = "bypassSNI"
            self.proxy = ""

    def __login(self, refreshToken=None, retry=True):
        """
        登录函数。
        """
        try:
            temp = self.STATIC.file.ain(
                self.getENV("rootPath") + "usr/.token.json") if refreshToken is None else {"token": refreshToken}
            self.__login_app_api(token=temp["token"])
        except Exception as e:
            if retry is False:
                self.STATIC.localMsger.error(e)
                input(self.lang("common.press_to_exit"))
                sys.exit(0)
            self.STATIC.localMsger.green(self.lang("loginHelper.hint_token_only"))
            if input(self.lang("loginHelper.is_need_to_get_token")) != "y":
                input(self.lang("common.press_to_exit"))
                sys.exit(0)
            self.STATIC.localMsger.msg(self.lang("loginHelper.hint_before_start"), header="Login Helper")
            helper = self.COMMON.loginHelper()
            if helper.check_network() is False:
                self.STATIC.localMsger.red(self.lang("loginHelper.fail_to_get_token_due_to_network"))
                input(self.lang("common.press_to_exit"))
                sys.exit(0)
            token = helper.login()
            if token is False:
                self.STATIC.localMsger.red(self.lang("loginHelper.fail_to_get_token_anyway"))
                input(self.lang("common.press_to_exit"))
                sys.exit(0)
            self.STATIC.file.aout(
                self.getENV("rootPath") + "usr/.token.json",
                {"token": token, },
                dRename=False,
            )
            self.__login(retry=False)

    def __login_app_api(self, token):
        """
        app 模式登录。
        """
        _REQUESTS_KWARGS = {}
        if self.proxy != "":
            _REQUESTS_KWARGS = {
                "proxies": {"https": self.proxy, },
            }
        if self.api_route == "bypassSNI":
            self.api = ByPassSniApi(**_REQUESTS_KWARGS)
            self.api.require_appapi_hosts(hostname=self.biuInfo["pApiURL"])
            self.api.set_accept_language("zh-cn")
        else:
            self.api = AppPixivAPI(**_REQUESTS_KWARGS)

        self.api.auth(refresh_token=token)

        self.STATIC.file.aout(
            self.getENV("rootPath") + "usr/.token.json",
            {"token": self.api.refresh_token, },
            dRename=False,
        )

        self.STATIC.localMsger.msg(f"{self.lang('common.success_to_login')} ({self.api_route})")

    def __show_ready_info(self):
        """
        展示初始化成功消息。
        """
        self.__clear()
        ver_extra = ""
        if not self.sets["sys"]["ignoreOutdated"] and self.biuInfo["version"] != -1:
            if self.ver >= int(self.biuInfo["version"]):
                ver_extra = self.lang("outdated.hint_latest")
            else:
                ver_extra = self.STATIC.localMsger.red(
                    f"%s@%s" % (self.lang("outdated.hint_exist_new"), self.format_version(self.biuInfo["version"])),
                    header=False, out=False)
            ver_extra = f" ({ver_extra})"
        self.STATIC.localMsger.arr(
            self.STATIC.localMsger.msg(self.lang("ready.done_init"), out=False),
            "------------",
            self.STATIC.localMsger.sign(" PixivBiu ", header=False, out=False),
            "-",
            (self.lang("ready.hint_run"), "%s (%s)" % (
                self.STATIC.localMsger.green("http://" + self.sets["sys"]["host"] + "/", header=False, out=False),
                self.lang("ready.hint_how_to_use"))),
            (self.lang("ready.hint_version"), "%s%s" % (self.format_version(), ver_extra)),
            (self.lang('ready.hint_function_types'), "%s, %s, deterPaths@%s" % (
                self.api_route, self.sets["biu"]["download"]["mode"],
                "on" if self.sets["biu"]["download"]["deterPaths"] else "off")),
            (self.lang("ready.hint_image_service"), self.pximgURL + "/"),
            (self.lang("ready.hint_download_path"),
             self.sets["biu"]["download"]["saveURI"].replace("{ROOTPATH}", self.lang("ready.hint_program_path"))),
            "-",
            self.STATIC.localMsger.sign(" Biu ", header=False, out=False),
            "------------"
        )
        t = threading.Timer(60 * 20, self.__pro_refresh_token)
        t.setDaemon(True)
        t.start()

    def __pro_refresh_token(self):
        """
        子线程，每 20 分钟刷新一次 refresh token 并重新登录，以持久化登录状态。
        :return: none
        """
        helper = self.COMMON.loginHelper()
        while True:
            self.STATIC.localMsger.msg(
                f"{self.lang('others.hint_in_update_token')}: %s"
                % time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time())))
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
                "created_time": self.STATIC.util.format_time(c["create_date"], "%Y-%m-%dT%H:%M:%S%z"),
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
        return "2.%s.%s%s" % (int(version[1:3]), int(version[3:5]), WORDS[int(version[-1])])

    def __set_image_host(self):
        """
        设置 pixiv 图片服务器地址。
        """
        if self.sets["biu"]["download"]["imageHost"] != "":
            self.pximgURL = self.sets["biu"]["download"]["imageHost"]
        elif self.api_route == "bypassSNI":
            self.pximgURL = "https://i.pixiv.re"

    @staticmethod
    def __clear():
        if os.name == "nt":
            os.system("cls")
        else:
            os.system("clear")
