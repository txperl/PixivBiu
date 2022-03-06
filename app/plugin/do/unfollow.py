from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/unfollow/", "PLUGIN")
class doUnFollow(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "unfollow",
                ["userID"],
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
        self.STATIC.arg.argsPurer(funArg, {"userID": "user_id"})
        r = self.CORE.biu.api.user_follow_delete(**funArg)
        return {"api": "public", "data": r}
