# thanks to @github/ZipFile, https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362
import datetime
import hashlib
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode

import requests

REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
AUTH_TOKEN_URL_HOST = "https://oauth.secure.pixiv.net"
CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
HASH_SECRET = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c"


class tokenGetter(object):
    def __init__(self, requests=requests):
        self.code = ""
        self.requests = requests
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
            print("注意: 程序每次启动时要求获取的 Code 都不同，不可复用之前获取到的，且 Code 不带有引号")
            print(f"1. 访问「{LOGIN_URL}?{urlencode(self.login_params)}」")
            print(
                "   (若您别无他法，还是不能访问以上网址，那可参考此方式 https://github.com/mashirozx/Pixiv-Nginx 先进行配置)"
            )
            print("2. 打开浏览器的「Dev Console / 开发者工具 / F12」，切换至「Network / 网络」标签")
            print("3. 开启「Preserve log / 持续记录」")
            print("4. 在「Filter / 筛选」文本框中输入「callback?」")
            print("5. 登录您的 Pixiv 账号")
            print(
                "6. 成功登录后，会出现一个类似「https://app-api.pixiv.net/.../callback?state=...&code=...」的字段"
            )
            print("7. 将「code」后面的参数输入本程序")
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
            headers=self.get_header({"host": "oauth.secure.pixiv.net"}),
            **kw,
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
        :return: 新 refresh token | except: raise error
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
            headers=self.get_header({"host": "oauth.secure.pixiv.net"}),
            **kw,
        )

        rst = response.json()

        if "refresh_token" in rst:
            return rst["refresh_token"]
        else:
            raise Exception("Request Error.\nResponse: " + str(rst))

    @staticmethod
    def get_header(headers={}):
        local_time = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S+00:00")
        headers["x-client-time"] = local_time
        headers["x-client-hash"] = hashlib.md5(
            (local_time + HASH_SECRET).encode("utf-8")
        ).hexdigest()
        if (
                headers.get("User-Agent", None) is None
                and headers.get("user-agent", None) is None
        ):
            headers["app-os"] = "ios"
            headers["app-os-version"] = "14.6"
            headers["user-agent"] = "PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)"
        return headers
