import requests

from altfe.interface.root import interRoot
from app.lib.common.login_helper.token import TokenGetter
from app.v2.utils.sprint import SPrint

_ln = lambda val, header="Login Helper": print(f"[{header}] " + val if header else val)


@interRoot.bind("loginHelper", "LIB_COMMON")
class CommonLoginHelper(interRoot):
    """
    Pixiv 登陆助手。
    可以优先进行网络检测以及筛选，以提高在网络不佳情况下的 Token 获取概率。
    """

    SOME_URLS = (
        "https://public-api.secure.pixiv.net",
        "https://1.0.0.1/dns-query",
        # "https://1.1.1.1/dns-query",
        # "https://doh.dns.sb/dns-query",
        # "https://cloudflare-dns.com/dns-query",
    )

    def __init__(self):
        self.lang = self.INS.i18n.get_bundle("app.common.loginHelper", func=True)
        self.requests = requests.Session()
        # self.requests.mount("https://", CustomAdapter())
        self.token_getter = TokenGetter(lang=self.lang, requests=self.requests)
        self.proxy = ""
        self.auth_token_url = ""

    def check_network(self, is_no_proxy: bool = False, is_silent: bool = False):
        """
        网络检测，并筛选出本机可通的 Pixiv API 服务器。
        :param URLS: 全部 URL
        :param silent: 是否静默进行
        :param proxy_: 代理设置，auto 为程序自动判断
        :return: bool
        """
        if is_no_proxy:
            return self._test_pixiv_connection(proxy="")

        is_pixiv_accessible = True

        # Determine the proxy address, or empty
        proxy = self.STATIC.util.get_system_proxy()
        if proxy != "" and self._test_pixiv_connection(proxy=proxy):
            pass
        elif self._test_pixiv_connection(proxy=""):
            proxy = ""
        elif is_silent is False:
            # Require to set proxy manually
            if input(
                self.lang("network.hint_detect_proxy") % proxy
                if proxy
                else self.lang("network.is_need_to_type_proxy")
            ) in ["y", ""]:
                proxy = input(self.lang("network.press_need_to_type_proxy"))
            is_pixiv_accessible = self._test_pixiv_connection(proxy=proxy)

        # For now, the bypass mode is disabled
        self.proxy = proxy
        self.auth_token_url = self.SOME_URLS[0]

        if not is_silent:
            _ln(
                (
                    SPrint.green("- Pixiv.net, yep!")
                    if is_pixiv_accessible
                    else SPrint.red("- Pixiv.net, ops...")
                ),
                header=None,
            )

        return is_pixiv_accessible

        # Determine the final auth host
        # Check if the hosts are accessible
        # is_conn_array = [
        #     self._test_access(url=url, proxy=self.proxy, is_silent=False)
        #     for url in self.SOME_URLS
        # ]

        # If Pixiv is accessible, just use the official
        # if is_conn_array[0]:
        #     self.auth_token_url = self.SOME_URLS[0]
        #     return True

        # Or, get the real ip of auth service from DoH service to bypass SNI
        # for i in range(len(self.SOME_URLS)):
        #     if is_conn_array[i] is False:
        #         continue
        #     final_ip = self._get_host_ip(
        #         hostname=self.SOME_URLS[0], url=self.SOME_URLS[i]
        #     )
        #     if final_ip is not False:
        #         self.auth_token_url = final_ip
        #         return True

        # return False

    def login(self):
        """
        登陆操作。
        :return: tuple(access token, refresh token, user id) || tuple(false, false, false)
        """
        kw = (
            {"proxies": {"http": self.proxy, "https": self.proxy}}
            if self.proxy != ""
            else {}
        )
        try:
            return self.token_getter.login(
                host=self.auth_token_url, newCode=True, kw=kw
            )
        except Exception as e:
            err = str(e)
            if "'code': 918" in err:
                self.STATIC.localMsger.red(self.lang("login.fail_code_918"))
            elif "'code': 1508" in err:
                self.STATIC.localMsger.red(self.lang("login.fail_code_1508"))
            else:
                self.STATIC.localMsger.error(e, header=False)
        return False, False, False

    def refresh(self, refresh_token):
        """
        Token 刷新操作。
        :param refresh_token: 目前已有的 refresh token
        :return: tuple(access token, refresh token, user id) || tuple(false, false, false)
        """
        kw = (
            {"proxies": {"http": self.proxy, "https": self.proxy}}
            if self.proxy != ""
            else {}
        )
        try:
            return self.token_getter.refresh(
                refresh_token=refresh_token, host=self.auth_token_url, kw=kw
            )
        except Exception as e:
            if "Invalid refresh token" in str(e):
                self.STATIC.localMsger.red(
                    "Common.LoginHelper.refresh: invalid refresh token"
                )
            else:
                self.STATIC.localMsger.error(e, header=False)
        return False, False, False

    def _get_host_ip(self, hostname, timeout=3, url="https://1.0.0.1/dns-query"):
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
                url, headers=headers, params=params, timeout=timeout
            )
            r = "https://" + response.json()["Answer"][0]["data"]
        except:
            return False
        return r

    def get_proxy(self) -> str:
        return self.proxy

    def is_bypass(self) -> bool:
        return self.auth_token_url != self.SOME_URLS[0]

    @classmethod
    def _test_access(cls, url: str, proxy: str = "", is_silent: bool = False):
        """
        request get 请求。
        :param url: URL
        :param proxy: 代理，留空则不使用
        :param silent: 是否静默运行
        :return: bool
        """
        is_ok = False
        try:
            if proxy != "":
                requests.head(url, proxies={"http": proxy, "https": proxy}, timeout=3)
                is_ok = True
            else:
                requests.head(url, timeout=3)
        except:
            pass
        if not is_silent:
            if is_ok:
                _ln(SPrint.green(f"- {url} [yep]"), header=None)
            else:
                _ln(SPrint.red(f"- {url} [ops]"), header=None)
        return is_ok

    @classmethod
    def _test_pixiv_connection(cls, proxy: str = "") -> bool:
        proxies = {"https": proxy, "http": proxy} if proxy != "" else None
        try:
            requests.head("https://pixiv.net/", proxies=proxies, timeout=2)
        except:
            return False
        return True


# class CustomAdapter(requests.adapters.HTTPAdapter):
#     """
#     防止在请求 Cloudflare 时可能的 SSL 相关错误。
#     Thanks to @github/grawity.
#     """

#     def init_poolmanager(self, *args, **kwargs):
#         # When urllib3 hand-rolls a SSLContext, it sets 'options |= OP_NO_TICKET'
#         # and CloudFlare really does not like this. We cannot control this behavior
#         # in urllib3, but we can just pass our own standard context instead.
#         import ssl

#         ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
#         ctx.load_default_certs()
#         ctx.set_alpn_protocols(["http/1.1"])
#         return super().init_poolmanager(*args, **kwargs, ssl_context=ctx)
