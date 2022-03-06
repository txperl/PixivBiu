from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/idmarks/", "PLUGIN")
class getIDWorks(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "userMarks",
                [
                    "userID=%s" % self.CORE.biu.api.user_id,
                    "restrict=public",
                    "&sortMode=0",
                    "&isSort=0",
                    "&totalPage=5",
                    "&groupIndex=0",
                    "&markNex=0",
                    "&tmp=0@0"
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": 1,
            "msg": {
                "way": "get",
                "args": args,
                "rst": self.gank(args["ops"], args["fun"].copy()),
            },
        }

    def gank(self, opsArg, funArg):
        self.STATIC.arg.argsPurer(funArg, {"userID": "user_id"})
        r = []

        ttlPage = int(opsArg["totalPage"])  # 页数

        if str(opsArg["groupIndex"]) != "0":
            mstart = str(opsArg["groupIndex"])
        else:
            mstart = None
        opsArg["markNex"] = "None"

        argg = funArg.copy()
        argg["max_bookmark_id"] = mstart
        for p in range(ttlPage):
            t = self.CORE.biu.api.user_bookmarks_illust(**argg)
            if "illusts" in t and len(t["illusts"]) != 0:
                r = r + t["illusts"]
                if not t["next_url"]:
                    opsArg["markNex"] = "None"
                    break
                argg = self.CORE.biu.api.parse_qs(t["next_url"])
                opsArg["markNex"] = argg["max_bookmark_id"]
            else:
                opsArg["markNex"] = "None"
                break

        if int(opsArg["isSort"]) == 1:
            if str(opsArg["sortMode"]) == "1":
                r = sorted(r, key=lambda kv: kv["total_view"], reverse=True)
            else:
                r = sorted(r, key=lambda kv: kv["total_bookmarks"], reverse=True)
        self.CORE.biu.app_works_purer(r)

        return {"api": "app", "data": r}
