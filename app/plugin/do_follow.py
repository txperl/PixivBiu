from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/follow/", "PLUGIN")
class doFollow(interRoot):
    def run(self, cmd):
        if self.CORE.biu.apiType != "public":
            return {"code": 0, "msg": "only support public api"}

        try:
            args = self.STATIC.arg.getArgs(
                "follow",
                [
                    "userID",
                    (
                            "restrict=%s"
                            % self.CORE.biu.sets["biu"]["common"]["defaultActionType"]
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
                "rst": self.follow(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def follow(self, opsArg, funArg):
        self.STATIC.arg.argsPurer(
            funArg, {"userID": "user_id", "restrict": "publicity"}
        )
        r = self.CORE.biu.api.me_favorite_users_follow(**funArg)
        return {"api": "public", "data": r}
