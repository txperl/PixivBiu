import requests

from altfe.interface.root import interRoot
from app.lib.common.login_helper.token import tokenGetter


@interRoot.bind("loginHelper", "LIB_COMMON")
class CommonLoginHelper(interRoot):
    """
    Pixiv 登陆助手。
    可以优先进行网络检测以及筛选，以提高在网络不佳情况下的 Token 获取概率。
    """

    def __init__(self):
        self.lang = self.INS.i18n.get_bundle("app.common.loginHelper", func=True)
        self.requests = requests.Session()
        self.requests.mount("https://", CustomAdapter())
        self.tokenG = tokenGetter(lang=self.lang, requests=self.requests)
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
            "https://doh.dns.sb/dns-query",
            "https://cloudflare-dns.com/dns-query",
        ) if URLS is None else URLS
        proxy = self.STATIC.util.get_system_proxy() if proxy_ == "auto" else proxy_
        if silent is False:
            self.STATIC.localMsger.msg(self.lang("network.hint_in_check"), header="Login Helper")
            if proxy == "":
                if input(self.lang("network.is_need_to_type_proxy")) == "y":
                    proxy = input(self.lang("network.press_need_to_type_proxy"))
            else:
                if input(self.lang("network.hint_detect_proxy") % proxy) == "y":
                    proxy = input(self.lang("network.press_need_to_type_proxy"))

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
                self.STATIC.localMsger.red(self.lang("login.fail_code_918"))
            elif "'code': 1508" in err:
                self.STATIC.localMsger.red(self.lang("login.fail_code_1508"))
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
        通过 DNS over HTTPS 服务获取主机的真实 IP 地址。
        :param hostname: 主机名
        :param timeout: 超时时间
        :return: str:{host ip} | False
        """
        hostname = hostname.replace("https://", "").replace("http://", "")
        headers = {"Accept": "application/dns-json"}
        params = {
            "name": hostname,
            "type": "A",
            "do": "false",
            "cd": "false",
        }
        try:
            response = self.requests.get(
                url, headers=headers, params=params, timeout=timeout, verify=False
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
                cls.STATIC.localMsger.red(f"{url} [ops]", header="Network")
            return False
        if silent is False:
            cls.STATIC.localMsger.green(f"{url} [yep]", header="Network")
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
