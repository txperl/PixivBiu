from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/unmark/", "PLUGIN")
class getRank(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("mark", ["workID"])
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
        self.STATIC.arg.argsPurer(funArg, {"workID": "illust_id"})
        r = self.CORE.biu.api.illust_bookmark_delete(**funArg)
        return {"api": "app", "data": r}
