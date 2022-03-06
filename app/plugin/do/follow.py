from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/follow/", "PLUGIN")
class doFollow(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("follow", ["userID", "publicity=public"])
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
            funArg, {"userID": "user_id", "publicity": "restrict"}
        )
        r = self.CORE.biu.api.user_follow_add(**funArg)
        return {"api": "app", "data": r}
