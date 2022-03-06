from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/recommend/", "PLUGIN")
class getRmd(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "recommend",
                [
                    "type=illust",
                    "&sortMode=0",
                    "&isSort=0",
                    "&totalPage=5",
                    "&groupIndex=0",
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
        self.STATIC.arg.argsPurer(funArg, {"type": "content_type"})
        status_arg = []
        r = []

        grpIdx = int(opsArg["groupIndex"])  # 组序号
        ttlPage = int(opsArg["totalPage"])  # 每组页数

        for p in range(grpIdx * ttlPage, (grpIdx + 1) * ttlPage):
            argg = funArg.copy()
            argg["offset"] = p * 30
            status_arg.append(argg)

        for x in self.CORE.biu.pool_srh.map(self.__thread_gank, status_arg):
            r += x

        if int(opsArg["isSort"]) == 1:
            if str(opsArg["sortMode"]) == "1":
                r = sorted(r, key=lambda kv: kv["total_view"], reverse=True)
            else:
                r = sorted(r, key=lambda kv: kv["total_bookmarks"], reverse=True)
        self.CORE.biu.app_works_purer(r)

        return {"api": "app", "data": r}

    def __thread_gank(self, kw):
        try:
            data = self.CORE.biu.api.illust_recommended(**kw)
        except:
            return []
        if "illusts" in data and len(data["illusts"]) != 0:
            return data["illusts"]
        return []
