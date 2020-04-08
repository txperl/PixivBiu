# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/get/outdated")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        return {
            "code": 1,
            "msg": self.MOD.biu.checkForUpdate()
        }