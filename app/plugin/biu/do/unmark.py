# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/do/unmark")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs("mark", ["workID"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": 1,
            "msg": {
                "way": "do",
                "args": args,
                "rst": self.unmark(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def unmark(self, opsArg, funArg):
        self.MOD.args.argsPurer(funArg, {"workID": "illust_id"})
        r = self.MOD.biu.apiAssist.illust_bookmark_delete(**funArg)
        return {"api": "app", "data": r}
