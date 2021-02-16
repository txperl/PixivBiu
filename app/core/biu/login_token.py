# thanks to @github/ZipFile, https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362
import platform
import requests
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode

from ...lib.common.msg import biuMsg
from ...lib.common.util import util

USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)"
REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
LOGIN_URL = "https://app-api.pixiv.net/web/v1/login"
AUTH_TOKEN_URL = "https://oauth.secure.pixiv.net/auth/token"
CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"


class login_with_token(object):
    def __init__(self):
        self.proxy = util.getSystemProxy(platform.system())
        self.code_verifier, self.code_challenge = self.oauth_pkce(self.s256)
        self.login_params = {
            "code_challenge": self.code_challenge,
            "code_challenge_method": "S256",
            "client": "pixiv-android",
        }
        self.msger = biuMsg("Login")

    def run(self):
        if self.proxy == "":
            tip = self.msger.msg("无法获取代理监听地址，是否要手动输入? (y / n): ", out=False)
        else:
            tip = self.msger.msg(f"获取到为 {self.proxy} 的代理监听地址，是否需要修改? (y / n): ", out=False)
        tmp = input(tip)
        if tmp == "y":
            self.proxy = input("请输入代理监听地址: ")

        self.msger.arr(
            "请按以下步骤进行操作:",
            f"1. 访问「{LOGIN_URL}?{urlencode(self.login_params)}」",
            "2. 打开浏览器的「开发者工具 / Dev Console / F12」，切换至「Network」标签",
            "3. 开启「Preserve log / 持续记录」",
            "4. 在「Filter / 筛选」文本框中输入「callback?」",
            "5. 登入您的 Pixiv 账号",
            "6. 成功登陆后，会出现一个类似「https://app-api.pixiv.net/.../callback?state=...&code=...」的字段，"
            "将「code」后面的参数输入本程序"
        )

        return self.login()

    def s256(self, data):
        """S256 transformation method."""

        return urlsafe_b64encode(sha256(data).digest()).rstrip(b"=").decode("ascii")

    def oauth_pkce(self, transform):
        """Proof Key for Code Exchange by OAuth Public Clients (RFC7636)."""

        code_verifier = token_urlsafe(32)
        code_challenge = transform(code_verifier.encode("ascii"))

        return code_verifier, code_challenge

    def login(self):
        code = input("code: ").strip()

        response = requests.post(
            AUTH_TOKEN_URL,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": code,
                "code_verifier": self.code_verifier,
                "grant_type": "authorization_code",
                "include_policy": "true",
                "redirect_uri": REDIRECT_URI,
            },
            headers={"User-Agent": USER_AGENT},
            proxies={"https": self.proxy}
        )
        rst = response.json()

        if "refresh_token" in rst:
            return rst["refresh_token"]
        else:
            return None
