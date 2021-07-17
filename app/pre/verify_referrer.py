import re

from flask import request

from altfe.interface.root import interRoot


@interRoot.bind("verifyReferrer", "PRE")
class pre_verify_referrer(interRoot):
    """
    预处理部分，负责 referrer 验证。
    """

    def __init__(self):
        self.conf = self.loadConfig(self.getENV("rootPathFrozen") + "app/config/switch.yml")
        self.type_ = self.conf["Security"]["onlyReferrer"]["type"]
        self.origin = self.conf["Security"]["onlyReferrer"]["origin"]
        if self.origin is None:
            self.origin = []

    def run(self, cmd):
        if cmd in ("file/", "api/get/text/"):
            if self.type_ == "ban":
                for x in self.origin:
                    if re.search(str(x), str(request.referrer)) is not None:
                        return False
            else:
                for x in self.origin:
                    if re.search(str(x), str(request.referrer)) is not None:
                        return True
                return False
        return True
