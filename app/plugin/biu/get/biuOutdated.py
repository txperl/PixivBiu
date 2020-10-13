# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor
import requests
import json

@CMDProcessor.plugin_register("api/biu/get/outdated")
class outdated(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        r = []
        try:
            r = json.loads(
                requests.get("https://biu.tls.moe/d/biuinfo.json", timeout=10).text
            )
        except:
            r = {"version": self.MOD.biu.ver + 1, "pApiURL": "public-api.secure.pixiv.net"}

        return {"code": 1, "msg": self.MOD.biu.ver >= r["version"]}

