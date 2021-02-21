# thanks to @github/ZipFile, https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362
import platform
import requests
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode
from requests_toolbelt.adapters import host_header_ssl

from ...lib.common.msg import biuMsg
from ...lib.common.util import util

USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)"
REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
AUTH_TOKEN_URL_HOST = "https://oauth.secure.pixiv.net"
CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"


class login_with_token(object):
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
        self.msger = biuMsg("Login")

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
            self.msger.arr(
                "[Login] 请按以下步骤进行操作:",
                f"1. 访问「{LOGIN_URL}?{urlencode(self.login_params)}」",
                "（若您别无他法，还是不能访问以上网址，那可参考此方式「https://github.com/mashirozx/Pixiv-Nginx」先进行配置）",
                "2. 打开浏览器的「开发者工具 / Dev Console / F12」，切换至「Network」标签",
                "3. 开启「Preserve log / 持续记录」",
                "4. 在「Filter / 筛选」文本框中输入「callback?」",
                "5. 登录您的 Pixiv 账号",
                "6. 成功登录后，会出现一个类似「https://app-api.pixiv.net/.../callback?state=...&code=...」的字段，"
                "将「code」后面的参数输入本程序"
            )
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
            headers={"User-Agent": USER_AGENT, "host": "oauth.secure.pixiv.net"},
            **kw
        )
        rst = response.json()

        if "refresh_token" in rst:
            return rst["refresh_token"]
        else:
            raise Exception("Request Error.\nResponse: " + str(rst))

    def get_proxy(self, proxy=""):
        """
        引导获取代理监听地址。
        :param proxy: 默认地址
        :return: 最终地址
        """
        proxy_ = proxy if proxy != "" else util.getSystemProxy(platform.system())
        if proxy_ == "":
            tip = self.msger.msg("无法获取代理监听地址，是否要手动输入? (y / n): ", out=False)
        else:
            tip = self.msger.msg(f"获取到值为 {proxy_} 的代理监听地址，是否需要修改? (y / n): ", out=False)
        tmp = input(tip)
        if tmp == "y":
            proxy_ = input("请输入代理监听地址: ")
        return proxy_

    def get_host_ip(self, hostname, timeout=3):
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
            response = requests.get(url, params=params, timeout=timeout)
        except Exception:
            url = "https://cloudflare-dns.com/dns-query"
            response = requests.get(url, params=params, timeout=timeout)

        return "https://" + response.json()['Answer'][0]['data']
