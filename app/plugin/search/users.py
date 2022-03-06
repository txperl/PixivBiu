from altfe.interface.root import interRoot


@interRoot.bind("api/biu/search/users/", "PLUGIN")
class searchUsers(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "searchUsers",
                [
                    "kt",
                    "&totalPage=5",
                    "&groupIndex=0",
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": 1,
            "msg": {
                "way": "search",
                "args": args,
                "rst": self.gank(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def gank(self, opsArg, funArg):
        self.STATIC.arg.argsPurer(funArg, {"kt": "word"})
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

        return {"api": "app", "data": r}

    def __thread_gank(self, kw):
        try:
            data = self.CORE.biu.api.search_user(**kw)
        except:
            return []
        if "user_previews" in data and len(data["user_previews"]) != 0:
            return [x["user"] for x in data["user_previews"]]
        return []
