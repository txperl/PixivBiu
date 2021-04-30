from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/dl_stop/", "PLUGIN")
class doDlStop(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("dl_stop", ["key"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        key = str(args["fun"]["key"])

        if key not in self.CORE.dl.tasks:
            return {"code": 0, "msg": "unknown parameters"}

        rep = self.CORE.dl.cancel(key)

        return {
            "code": 1,
            "msg": {"way": "do", "args": args, "rst": rep},
        }
