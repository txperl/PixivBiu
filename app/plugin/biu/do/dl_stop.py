# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/do/dl_stop")
class doDownloadStop(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("biu_dl_stop", ["workID"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        key = str(args["fun"]["workID"])

        if key not in self.MOD.biu.STATUS["rate_download"]:
            return {"code": 0, "msg": "unknown parameters"}

        rep = []

        for x in self.MOD.biu.STATUS["rate_download"][key]:
            rep.append(x.cancel())

        return {
            "code": 1,
            "msg": {"way": "do", "args": args, "rst": rep,},
        }

