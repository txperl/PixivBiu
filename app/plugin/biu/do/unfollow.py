# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/do/unfollow")
class doUnFollow(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        if self.MOD.biu.apiType != "public":
            return {"code": 0, "msg": "only support public api"}

        try:
            args = self.MOD.args.getArgs(
                "unfollow",
                [
                    "userID",
                    (
                        "restrict=%s"
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
                "rst": self.unFollow(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def unFollow(self, opsArg, funArg):
        self.MOD.args.argsPurer(
            funArg, {"userID": "user_ids", "restrict": "publicity"}
        )
        r = self.MOD.biu.api.me_favorite_users_unfollow(**funArg)
        return {"api": "public", "data": r}
