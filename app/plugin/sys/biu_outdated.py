import json

import requests

from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/outdated/", "PLUGIN")
class outdated(interRoot):
    def run(self, cmd):
        r = self.CORE.biu.biuInfo
        try:
            r = json.loads(requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=6).text)
        finally:
            return {"code": 1,
                    "msg": {"latest": self.CORE.biu.ver >= r["version"], "current": self.CORE.biu.format_version(),
                            "online": r}}
