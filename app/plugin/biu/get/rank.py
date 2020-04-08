# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor


@CMDProcessor.plugin_register("api/biu/get/rank")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs(
                "rank", ["mode=day", "&totalPage=5", "&groupIndex=0"]
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
        status_arg = []
        r = []

        grpIdx = int(opsArg["groupIndex"])  # 组序号
        ttlPage = int(opsArg["totalPage"])  # 每组页数

        for p in range(grpIdx * ttlPage, (grpIdx + 1) * ttlPage):
            argg = funArg.copy()
            argg["offset"] = p * 30
            status_arg.append(argg)

        for x in self.MOD.biu.pool_srh.map(self.__thread_rank, status_arg):
            r += x
        self.MOD.biu.appWorksPurer(r)

        return {"api": "app", "data": r}

    def __thread_rank(self, kw):
        try:
            data = self.MOD.biu.apiAssist.illust_ranking(**kw)
        except:
            return []
        if "illusts" in data and len(data["illusts"]) != 0:
            return data["illusts"]
        return []
