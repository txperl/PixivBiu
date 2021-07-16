from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/follow/", "PLUGIN")
class doFollow(interRoot):
    def run(self, cmd):
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
            funArg, {"userID": "user_id", "restrict": "restrict"}
        )
        r = self.CORE.biu.apiAssist.user_follow_add(**funArg)
        return {"api": "public", "data": r}
