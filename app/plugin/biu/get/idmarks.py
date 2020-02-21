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
                    "&isSort=0",
                    "&totalPage=all",
                    "&groupIndex=all",
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": 1,
            "msg": {
                "way": "get",
                "args": args,
                "rst": self.gank(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def gank(self, opsArg, funArg):
        self.MOD.args.argsPurer(funArg, {"userID": "user_id"})
        argg = funArg.copy()
        r = []

        while True:
            t = self.MOD.biu.apiAssist.user_bookmarks_illust(**argg)
            if "illusts" in t and len(t["illusts"]) != 0:
                r = r + t["illusts"]
                if not t["next_url"]:
                    break
                argg = self.MOD.biu.apiAssist.parse_qs(t["next_url"])
            else:
                break

        if int(opsArg["isSort"]) == 1:
            r = sorted(r, key=lambda kv: kv["total_bookmarks"], reverse=True)
        self.MOD.biu.appWorksPurer(r)

        return {"api": "app", "data": r}
