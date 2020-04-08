# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/do/mark")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs(
                "mark",
                [
                    "workID",
                    (
                        "publicity=%s"
                        % self.MOD.biu.sets["biu"]["common"]["defaultActionType"]
                    ),
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": 1,
            "msg": {
                "way": "do",
                "args": args,
                "rst": self.mark(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def mark(self, opsArg, funArg):
        self.MOD.args.argsPurer(
            funArg, {"workID": "illust_id", "publicity": "restrict"}
        )
        r = self.MOD.biu.apiAssist.illust_bookmark_add(**funArg)
        return {"api": "app", "data": r}
