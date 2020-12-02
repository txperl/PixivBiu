# coding=utf-8
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/get/status")
class getStatus(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("biu_status", ["type", "key"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        idx = "rate_" + args["fun"]["type"]
        key = str(args["fun"]["key"])

        if args["fun"]["type"] == "search" and key not in self.MOD.biu.STATUS[idx]:
            return {"code": 0, "msg": "unknown parameters"}
        elif args["fun"]["type"] == "download" and key not in self.MOD.dl.tasks and key != "__all__":
            return {"code": 0, "msg": "unknown parameters"}

        rep = []

        if idx == "rate_download":
            if key == "__all__":
                rep = self.MOD.dl.status()
            else:
                for x in self.MOD.dl.status(key):
                    if x == "done":
                        rep.append(True)
                    elif x is None or x == "failed":
                        rep.append(False)
                    else:
                        rep.append("running")
        elif idx == "rate_search":
            for x in self.MOD.biu.STATUS[idx][key]:
                if x.done():
                    rep.append(True)
                else:
                    rep.append("running")

        return {
            "code": 1,
            "msg": {"way": "get", "args": args, "rst": rep, },
        }
