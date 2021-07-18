import platform

import requests

from altfe.interface.root import interRoot
from app.lib.common.login_helper.token import tokenGetter


@interRoot.bind("loginHelper", "LIB_COMMON")
class common_loginHelper(interRoot):
    """
    Pixiv 登陆助手。
    可以优先进行网络检测以及筛选，以提高在网络不佳情况下的 Token 获取概率。
    """

    def __init__(self):
        self.requests = requests.Session()
        self.requests.mount("https://", CustomAdapter())
        self.tokenG = tokenGetter(self.requests)
        self.proxy = ""
        self.authTokenURL = ""

    def check_network(self, URLS=None, silent=False, proxy_="auto"):
        """
        网络检测。筛选出本机可通的 Pixiv API 服务器。
        :param URLS: 全部 URL
        :param silent: 是否静默进行
        :param proxy_: 代理设置，auto 为程序自动判断
        :return: bool
        """
        URLS = (
            "https://public-api.secure.pixiv.net",
            "https://1.0.0.1/dns-query",
            "https://1.1.1.1/dns-query",
            "https://[2606:4700:4700::1001]/dns-query",
            "https://[2606:4700:4700::1111]/dns-query",
            "https://cloudflare-dns.com/dns-query"
        ) if URLS is None else URLS
        proxy = self.STATIC.util.getSystemProxy(platform.system()) if proxy_ == "auto" else proxy_
        if silent is False:
            self.STATIC.localMsger.msg("开始进行网络检测...", header="Login Helper")
            if proxy == "":
                if input("未能检测到系统代理地址，是否需要手动设置? (y / n): ") == "y":
                    proxy = input("请输入代理监听地址(可留空): ")
            else:
                if input(f"检测到内容为 {proxy} 的代理监听地址，是否需要更改? (y / n): ") == "y":
                    proxy = input("请输入代理监听地址(可留空): ")

        self.proxy = proxy
        self.authTokenURL = URLS[0]

        isCanConn = [self._get(url, proxy=self.proxy, silent=silent) for url in URLS]

        if isCanConn[0] is True:
            return True

        for i in range(len(URLS)):
            if isCanConn[i]:
                finalIP = self._get_host_ip(hostname=URLS[0], url=URLS[i])
                if finalIP is not False:
                    self.authTokenURL = finalIP
                    return True

        return False

    def login(self):
        """
        登陆操作。
        :return: bool
        """
        kw = (
            {"proxies": {"http": self.proxy, "https": self.proxy}}
            if self.proxy != ""
            else {}
        )
        try:
            return self.tokenG.login(host=self.authTokenURL, newCode=True, kw=kw)
        except Exception as e:
            err = str(e)
            if "'code': 918" in err:
                self.STATIC.localMsger.red(
                    "Code 错误。请注意程序每次启动时要求获取的 Code 都不同，不可复用之前获取到的，且 Code 不带有引号。"
                )
            elif "'code': 1508" in err:
                self.STATIC.localMsger.red("Code 已过期。请在进行 Code 获取操作时快一些。")
            else:
                self.STATIC.localMsger.error(e, header=False)
            return False

    def refresh(self, refresh_token):
        """
        Token 刷新操作。
        :param refresh_token: 目前已有的 refresh token
        :return: bool
        """
        kw = (
            {"proxies": {"http": self.proxy, "https": self.proxy}}
            if self.proxy != ""
            else {}
        )
        try:
            return self.tokenG.refresh(refresh_token=refresh_token, host=self.authTokenURL, **kw)
        except Exception as e:
            self.STATIC.localMsger.error(e, header=False)
            return False

    def _get_host_ip(self, hostname, timeout=5, url="https://1.0.0.1/dns-query"):
        """
        通过 Cloudflare 的 DNS over HTTPS 获取主机的真实 IP 地址。
        :param hostname: 主机名
        :param timeout: 超时时间
        :return: str:{host ip} | False
        """
        hostname = hostname.replace("https://", "").replace("http://", "")
        params = {
            "ct": "application/dns-json",
            "name": hostname,
            "type": "A",
            "do": "false",
            "cd": "false",
        }
        try:
            response = self.requests.get(
                url, verify=False, params=params, timeout=timeout
            )
            r = "https://" + response.json()["Answer"][0]["data"]
        except:
            return False
        return r

    @classmethod
    def _get(cls, url, proxy="", silent=False):
        """
        request get 请求。
        :param url: URL
        :param proxy: 代理，留空则不使用
        :param silent: 是否静默运行
        :return: bool
        """
        try:
            if proxy != "":
                requests.get(
                    url,
                    proxies={"http": proxy, "https": proxy},
                    timeout=3,
                    verify=False,
                )
            else:
                requests.get(url, timeout=3, verify=False)
        except:
            if silent is False:
                cls.STATIC.localMsger.msg(f"{url} ❌", header="Network Checker")
            return False
        if silent is False:
            cls.STATIC.localMsger.msg(f"{url} ✔️", header="Network Checker")
        return True


class CustomAdapter(requests.adapters.HTTPAdapter):
    """
    防止在请求 Cloudflare 时可能的 SSL 相关错误。
    Thanks to @github/grawity.
    """

    def init_poolmanager(self, *args, **kwargs):
        # When urllib3 hand-rolls a SSLContext, it sets 'options |= OP_NO_TICKET'
        # and CloudFlare really does not like this. We cannot control this behavior
        # in urllib3, but we can just pass our own standard context instead.
        import ssl

        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_default_certs()
        ctx.set_alpn_protocols(["http/1.1"])
        return super().init_poolmanager(*args, **kwargs, ssl_context=ctx)
