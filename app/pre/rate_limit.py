from flask import request

from altfe.interface.root import interRoot


@interRoot.bind("rateLimit", "PRE")
class pre_rate_limit(interRoot):
    """
    预处理部分，负责 rate limit 管理。
    """

    def __init__(self):
        self.conf = self.loadConfig(self.getENV("rootPath") + "app/config/switch.yml")
        self.maxRequests = self.conf["Security"]["rateLimit"]["maxRequests"]
        self.timeSeconds = self.conf["Security"]["rateLimit"]["timeSeconds"]
        self.allowOrigin = self.conf["Security"]["rateLimit"]["allowOrigin"]
        self.banOrigin = self.conf["Security"]["rateLimit"]["banOrigin"]

    def run(self, cmd):
        ip = request.environ.get("HTTP_X_FORWARDED_FOR")
        if request.environ.get("HTTP_X_FORWARDED_FOR") is None:
            ip = request.environ["REMOTE_ADDR"]
        if ip is None or ip in self.banOrigin:
            return False
        if ip in self.allowOrigin:
            return True
        visNum = self.CORE.cache.get(f"__rt_{ip}", "visnum", True)
        if visNum is None:
            self.CORE.cache.set(f"__rt_{ip}", "", expire=self.timeSeconds)
        elif visNum > self.maxRequests:
            return False
        return True
