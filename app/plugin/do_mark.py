from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/mark/", "PLUGIN")
class getRank(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "mark",
                [
                    "workID",
                    (
                            "publicity=%s"
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
                "rst": self.mark(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def mark(self, opsArg, funArg):
        self.STATIC.arg.argsPurer(
            funArg, {"workID": "illust_id", "publicity": "restrict"}
        )
        r = self.CORE.biu.apiAssist.illust_bookmark_add(**funArg)
        return {"api": "app", "data": r}
