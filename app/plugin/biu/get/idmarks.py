# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/get/idmarks")
class getIDWorks(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs(
                "userMarks",
                [
                    "userID=%s" % self.MOD.biu.apiAssist.user_id,
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
        self.MOD.args.argsPurer(funArg, {"userID": "user_id"})
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
            t = self.MOD.biu.apiAssist.user_bookmarks_illust(**argg)
            if "illusts" in t and len(t["illusts"]) != 0:
                r = r + t["illusts"]
                if not t["next_url"]:
                    opsArg["markNex"] = "None"
                    break
                argg = self.MOD.biu.apiAssist.parse_qs(t["next_url"])
                opsArg["markNex"] = argg["max_bookmark_id"]
            else:
                opsArg["markNex"] = "None"
                break

        if int(opsArg["isSort"]) == 1:
            if str(opsArg["sortMode"]) == "1":
                r = sorted(r, key=lambda kv: kv["total_view"], reverse=True)
            else:
                r = sorted(r, key=lambda kv: kv["total_bookmarks"], reverse=True)
        self.MOD.biu.appWorksPurer(r)

        return {"api": "app", "data": r}
