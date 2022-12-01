from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/rank/", "PLUGIN")
class getRank(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "rank", ["mode=day", "date=0", "&totalPage=5", "&groupIndex=0"]
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        if len(str(args["fun"]["date"]).split("-")) != 3:
            args["fun"]["date"] = None

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

        for x in self.CORE.biu.pool_srh.map(self.__thread_rank, status_arg):
            r += x
        self.CORE.biu.app_works_purer(r)

        return {"api": "app", "data": r}

    def __thread_rank(self, kw):
        try:
            data = self.CORE.biu.api.illust_ranking(**kw)
            return data["illusts"]
        except Exception as e:
            self.STATIC.localMsger.error(e)
        return []
