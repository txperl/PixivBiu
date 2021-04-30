# thanks to @github/ZipFile, https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362
import platform
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode

import requests
from requests_toolbelt.adapters import host_header_ssl

from altfe.interface.root import interRoot

USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)"
REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
AUTH_TOKEN_URL_HOST = "https://oauth.secure.pixiv.net"
CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"


@interRoot.bind("token", "LIB_COMMON")
class common_token(interRoot):
    def __init__(self):
        self.code = ""
        session = requests.Session()
        session.mount('https://', host_header_ssl.HostHeaderSSLAdapter())
        self.requests = session
        self.code_verifier, self.code_challenge = self.oauth_pkce(self.s256)
        self.login_params = {
            "code_challenge": self.code_challenge,
            "code_challenge_method": "S256",
            "client": "pixiv-android",
        }

    def s256(self, data):
        """S256 transformation method."""

        return urlsafe_b64encode(sha256(data).digest()).rstrip(b"=").decode("ascii")

    def oauth_pkce(self, transform):
        """Proof Key for Code Exchange by OAuth Public Clients (RFC7636)."""

        code_verifier = token_urlsafe(32)
        code_challenge = transform(code_verifier.encode("ascii"))

        return code_verifier, code_challenge

    def login(self, host=AUTH_TOKEN_URL_HOST, kw={}, newCode=False):
        """
        尝试通过 Code 获取 Refresh Token。
        :param host: token api 的主机域
        :param kw: requests 请求的额外参数
        :param newCode: 是否继承使用 code
        :return: str: refresh token | except: raise error
        """
        if newCode is False and self.code != "":
            code = self.code
        else:
            print("[Login] 请按以下步骤进行操作:")
            print("注意: 程序每次启动时要求获取的 Code 都不同，不可复用之前获取到的，且 Code 不带有任何引号或等号")
            print(f"1. 访问「{LOGIN_URL}?{urlencode(self.login_params)}」")
            print("（若您别无他法，还是不能访问以上网址，那可参考此方式「https://github.com/mashirozx/Pixiv-Nginx」先进行配置）")
            print("2. 打开浏览器的「开发者工具 / Dev Console / F12」，切换至「Network」标签")
            print("3. 开启「Preserve log / 持续记录」")
            print("4. 在「Filter / 筛选」文本框中输入「callback?」")
            print("5. 登录您的 Pixiv 账号")
            print("6. 成功登录后，会出现一个类似「https://app-api.pixiv.net/.../callback?state=...&code=...」的字段，")
            print("将「code」后面的参数输入本程序")
            code = input("Code: ").strip()
        self.code = code

        response = self.requests.post(
            "%s/auth/token" % host,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": code,
                "code_verifier": self.code_verifier,
                "grant_type": "authorization_code",
                "include_policy": "true",
                "redirect_uri": REDIRECT_URI,
            },
            verify=False,
            timeout=10,
            headers={"User-Agent": USER_AGENT, "host": "oauth.secure.pixiv.net"},
            **kw
        )
        rst = response.json()

        if "refresh_token" in rst:
            return rst["refresh_token"]
        else:
            raise Exception("Request Error.\nResponse: " + str(rst))

    def refresh(self, refresh_token, host=AUTH_TOKEN_URL_HOST, kw={}):
        """
        刷新 refresh token。
        :param refresh_token: 目前可用的 refresh token
        :param host: token api 的主机域
        :param kw: requests 请求的额外参数
        :return: 新 refresh token
        """
        response = self.requests.post(
            "%s/auth/token" % host,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type": "refresh_token",
                "include_policy": "true",
                "refresh_token": refresh_token,
            },
            verify=False,
            timeout=10,
            headers={"User-Agent": USER_AGENT, "host": "oauth.secure.pixiv.net"},
            **kw
        )

        rst = response.json()

        if "refresh_token" in rst:
            return rst["refresh_token"]
        else:
            raise Exception("Request Error.\nResponse: " + str(rst))

    @classmethod
    def get_proxy(cls, proxy=""):
        """
        引导获取代理监听地址。
        :param proxy: 默认地址
        :return: 最终地址
        """
        proxy_ = proxy if proxy != "" else cls.STATIC.util.getSystemProxy(platform.system())
        if proxy_ == "":
            tip = "无法获取代理监听地址，是否要手动输入? (y / n): "
        else:
            tip = f"获取到值为 {proxy_} 的代理监听地址，是否需要修改? (y / n): "
        tmp = input(tip)
        if tmp == "y":
            proxy_ = input("请输入代理监听地址: ")
        return proxy_

    @staticmethod
    def get_host_ip(hostname, timeout=5):
        """
        获取域名的真实 IP 地址。
        :param hostname: 域名
        :param timeout: 超时时间
        :return: str: host ip | except
        """
        url = "https://1.0.0.1/dns-query"
        params = {
            'ct': 'application/dns-json',
            'name': hostname,
            'type': 'A',
            'do': 'false',
            'cd': 'false',
        }

        try:
            response = requests.get(url, verify=False, params=params, timeout=timeout)
        except Exception:
            url = "https://cloudflare-dns.com/dns-query"
            response = requests.get(url, params=params, timeout=timeout)

        return "https://" + response.json()['Answer'][0]['data']
