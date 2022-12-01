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


class TokenGetter(object):
    def __init__(self, lang, requests=requests):
        self.lang = lang
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
        :return: tuple(access token, refresh token, user id) || except: raise error
        """
        if newCode is False and self.code != "":
            code = self.code
        else:
            print(self.lang("login.hint_intro_step_head"))
            print(self.lang("login.hint_intro_step_1") % (LOGIN_URL, urlencode(self.login_params)))
            print(self.lang("login.hint_intro_step_2"))
            print(self.lang("login.hint_intro_step_3"))
            print(self.lang("login.hint_intro_step_4"))
            print(self.lang("login.hint_intro_step_5"))
            print(self.lang("login.hint_intro_step_6"))
            print(self.lang("login.hint_intro_step_7"))
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
        if "access_token" in rst and "refresh_token" in rst:
            return rst["access_token"], rst["refresh_token"], rst["user"]["id"]
        raise Exception("Request Error.\nResponse: " + str(rst))

    def refresh(self, refresh_token, host=AUTH_TOKEN_URL_HOST, kw={}):
        """
        刷新 refresh token。
        :param refresh_token: 目前可用的 refresh token
        :param host: token api 的主机域
        :param kw: requests 请求的额外参数
        :return: tuple(access token, refresh token, user id) || except: raise error
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
        if "access_token" in rst and "refresh_token" in rst:
            return rst["access_token"], rst["refresh_token"], rst["user"]["id"]
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
