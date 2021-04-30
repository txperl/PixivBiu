from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/unfollow/", "PLUGIN")
class doUnFollow(interRoot):
    def run(self, cmd):
        if self.CORE.biu.apiType != "public":
            return {"code": 0, "msg": "only support public api"}

        try:
            args = self.STATIC.arg.getArgs(
                "unfollow",
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
                "rst": self.unFollow(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def unFollow(self, opsArg, funArg):
        self.STATIC.arg.argsPurer(
            funArg, {"userID": "user_ids", "restrict": "publicity"}
        )
        r = self.CORE.biu.api.me_favorite_users_unfollow(**funArg)
        return {"api": "public", "data": r}
