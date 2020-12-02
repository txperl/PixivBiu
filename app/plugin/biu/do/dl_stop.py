# coding=utf-8
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/do/dl_stop")
class doDlStop(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("dl_stop", ["key"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        key = str(args["fun"]["key"])

        if key not in self.MOD.dl.tasks:
            return {"code": 0, "msg": "unknown parameters"}

        rep = self.MOD.dl.cancel(key)

        return {
            "code": 1,
            "msg": {"way": "do", "args": args, "rst": rep},
        }
