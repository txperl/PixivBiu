import re
from concurrent.futures import as_completed

from altfe.interface.root import interRoot


@interRoot.bind("api/biu/search/works/", "PLUGIN")
class searchWorks(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs(
                "works",
                [
                    "kt",
                    "mode=tag",
                    "&totalPage=5",
                    "&groupIndex=0",
                    "&sortMode=0",
                    "&isSort=0",
                    "&isCache=1",
                    "&isAiWork=1",
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        code = 1
        isCache = (
            int(args["ops"]["isCache"])
            and self.CORE.biu.sets["biu"]["search"]["loadCacheFirst"]
        )
        cachePath = self.getENV("rootPath") + "usr/cache/search/"
        fileName = "%s@%s_%sx%s_%s%s%s.json" % (
            args["fun"]["kt"],
            args["fun"]["mode"],
            args["ops"]["totalPage"],
            args["ops"]["groupIndex"],
            args["ops"]["sortMode"],
            args["ops"]["isSort"],
            args["ops"]["isAiWork"],
        )
        fileName = re.sub(r'[/\\:*?"<>|]', "_", fileName)

        if isCache:
            isCacheFile = self.STATIC.file.ain(cachePath + fileName)
        if isCache and isCacheFile:
            rst = isCacheFile
            code = 2
        else:
            rst = self.appWorks(args["ops"].copy(), args["fun"].copy())
            self.STATIC.file.aout(cachePath + fileName, rst, "w", False)

        return {
            "code": code,
            "msg": {"way": "search", "args": args, "rst": rst},
        }

    # app api 搜索
    def appWorks(self, opsArg, funArg):
        modes = {
            "tag": "partial_match_for_tags",
            "otag": "exact_match_for_tags",
            "des": "title_and_caption",
        }

        r = {"api": "app", "total": 0, "data": []}
        # search_target
        self.STATIC.arg.argsPurer(funArg, {"kt": "word", "mode": "search_target"})
        funArg["search_target"] = modes[funArg["search_target"]]
        funArg["search_ai_type"] = 0 if opsArg["isAiWork"] == "0" else 1

        status = []

        grpIdx = int(opsArg["groupIndex"])  # 组序号
        ttlPage = int(opsArg["totalPage"])  # 每组页数

        for p in range(grpIdx * ttlPage, (grpIdx + 1) * ttlPage):
            argg = funArg.copy()
            argg["offset"] = p * 30
            status.append(self.CORE.biu.pool_srh.submit(self.__thread_appWorks, **argg))

        self.CORE.biu.update_status(
            "search",
            (funArg["word"] + "_" + str(ttlPage) + "+" + str(grpIdx)),
            status,
        )

        for x in as_completed(status):
            r["data"] += x.result()

        r["total"] = len(r["data"])

        if int(opsArg["isSort"]) == 1:
            if str(opsArg["sortMode"]) == "1":
                r["data"] = sorted(
                    r["data"], key=lambda kv: kv["total_view"], reverse=True
                )
            else:
                r["data"] = sorted(
                    r["data"], key=lambda kv: kv["total_bookmarks"], reverse=True
                )
        self.CORE.biu.app_works_purer(r["data"])

        return r

    def __thread_appWorks(self, **kw):
        try:
            data = self.CORE.biu.api.search_illust(**kw)
            return data["illusts"]
        except Exception as e:
            self.STATIC.localMsger.error(e)
        return []
