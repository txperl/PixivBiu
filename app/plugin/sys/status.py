from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/status/", "PLUGIN")
class getStatus(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("biu_status", ["type", "key"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        idx = "rate_" + args["fun"]["type"]
        key = str(args["fun"]["key"])

        if args["fun"]["type"] == "search" and key not in self.CORE.biu.STATUS[idx]:
            return {"code": 0, "msg": "unknown parameters"}
        elif args["fun"]["type"] == "download" and key not in self.CORE.dl.tasks and key != "__all__":
            return {"code": 0, "msg": "unknown parameters"}

        rep = []

        if idx == "rate_download":
            if key == "__all__":
                rep = self.CORE.dl.status()
            else:
                for x in self.CORE.dl.status(key):
                    if x == "done":
                        rep.append("done")
                    elif x is None or x == "failed":
                        rep.append("failed")
                    else:
                        rep.append("running")
        elif idx == "rate_search":
            for x in self.CORE.biu.STATUS[idx][key]:
                if x.done():
                    rep.append("done")
                else:
                    rep.append("running")

        return {
            "code": 1,
            "msg": {"way": "get", "args": args, "rst": rep, },
        }
