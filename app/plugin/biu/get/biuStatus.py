# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/get/status")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("biu_status", ["type", "key"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        idx = "rate_" + args["fun"]["type"]
        key = str(args["fun"]["key"])

        if idx not in self.MOD.biu.STATUS or key not in self.MOD.biu.STATUS[idx]:
            return {"code": 0, "msg": "unknown parameters"}

        rep = []

        for x in self.MOD.biu.STATUS[idx][key]:
            if x.done():
                if idx == 'rate_download':
                    rep.append(x.result())
                elif idx == 'rate_search':
                    rep.append(True)
            else:
                rep.append("running")
        
        return {
            "code": 1,
            "msg": {"way": "get", "args": args, "rst": rep,},
        }

