from concurrent.futures.thread import ThreadPoolExecutor

from .dler_aria2 import Aria2Dler
from .dler_dl import DlDler
from .dler_dl_single import DlSingleDler


class BiuDler(object):
    WAYS = {"aria2": Aria2Dler, "dl": DlDler, "dl-single": DlSingleDler}

    def __init__(self, way="dl", dlMax=5):
        self.mod = BiuDler.WAYS[way]
        self._tasks = {}
        self._pool = ThreadPoolExecutor(max_workers=dlMax)

    def add(self, key, args):
        group = [self.mod(**kw) for kw in args]
        self._tasks[key] = group
        for obj in group:
            self._pool.submit(obj.run)

    def status(self, key="__all__"):
        r = {}
        if key == "__all__":
            for x in self._tasks:
                r[x] = (self._status(x))
        else:
            if key in self._tasks:
                return self._status(key)
        return r

    def _status(self, key):
        r = []
        group = self._tasks[key]
        for obj in group:
            tmp = "unknown"
            if obj.status(DlDler.CODE_GOOD_SUCCESS):
                tmp = "done"
            elif obj.status(DlDler.CODE_GOOD):
                tmp = "running"
            elif obj.status(DlDler.CODE_WAIT):
                tmp = "waiting"
            elif obj.status(DlDler.CODE_BAD):
                tmp = "failed"
            r.append(tmp)
        return r

    def info(self, key="__all__"):
        r = {}
        if key == "__all__":
            for x in self._tasks:
                r[x] = (self._info(x))
        else:
            if key in self._tasks:
                return self._info(key)
        return r

    def _info(self, key):
        r = {}
        totalSize = 0
        totalIngSize = 0
        totalIngSpeed = 0

        group = self._tasks[key]
        tmp = [obj.info() for obj in group]

        for x in tmp:
            totalSize += x["size"]
            totalIngSize += x["ingSize"]
            totalIngSpeed += x["ingSpeed"]

        r = {
            "totalSize": totalSize,
            "totalIngSize": totalIngSize,
            "totalIngSpeed": totalIngSpeed,
            "tasks": tmp
        }

        return r
