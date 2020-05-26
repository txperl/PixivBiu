# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor
from concurrent.futures import as_completed


@CMDProcessor.plugin_register("api/biu/search/works")
class searchWorks(object):
    def __init__(self, MOD):
        self.MOD = MOD

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs(
                "works",
                [
                    "kt",
                    "mode=tag",
                    "&totalPage=5",
                    "&groupIndex=0",
                    "&sortMode=0",
                    "&isSort=1",
                    "&isCache=1",
                ],
            )
        except:
            return {"code": 0, "msg": "missing parameters"}

        code = 1

        isCache = (
            int(args["ops"]["isCache"])
            and self.MOD.biu.sets["biu"]["search"]["loadCacheFirst"]
        )

        cachePath = self.MOD.ENVIRON["ROOTPATH"] + "usr/cache/data_search/"
        fileName = (
            (
                "%s@%s_%s+%s_%s%s.json"
                % (
                    args["fun"]["kt"],
                    args["fun"]["mode"],
                    args["ops"]["totalPage"],
                    args["ops"]["groupIndex"],
                    args["ops"]["sortMode"],
                    args["ops"]["isSort"],
                )
            )
            .replace("\\", "#")
            .replace("/", "#")
            .replace(":", "#")
            .replace("*", "#")
            .replace("?", "#")
            .replace('"', "#")
            .replace("<", "#")
            .replace(">", "#")
            .replace("|", "#")
        )

        if isCache:
            isCacheFile = self.MOD.file.ain(cachePath + fileName)

        if isCache and isCacheFile:
            rst = isCacheFile
            code = 2
        else:
            rst = self.appWorks(args["ops"].copy(), args["fun"].copy())
            self.MOD.file.aout(cachePath + fileName, rst, "w", False)

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
        self.MOD.args.argsPurer(funArg, {"kt": "word", "mode": "search_target"})
        funArg["search_target"] = modes[funArg["search_target"]]

        status = []

        grpIdx = int(opsArg["groupIndex"])  # 组序号
        ttlPage = int(opsArg["totalPage"])  # 每组页数

        for p in range(grpIdx * ttlPage, (grpIdx + 1) * ttlPage):
            argg = funArg.copy()
            argg["offset"] = p * 30
            status.append(self.MOD.biu.pool_srh.submit(self.__thread_appWorks, **argg))

        self.MOD.biu.updateStatus(
            "search", (funArg["word"] + "_" + str(ttlPage) + "+" + str(grpIdx)), status,
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
        self.MOD.biu.appWorksPurer(r["data"])

        return r

    def __thread_appWorks(self, **kw):
        data = self.MOD.biu.apiAssist.search_illust(**kw)
        if "illusts" in data and len(data["illusts"]) != 0:
            return data["illusts"]
        return []
