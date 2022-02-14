import threading
from concurrent.futures.thread import ThreadPoolExecutor

from altfe.interface.root import interRoot
from app.lib.core.dl.model.dler_aria2 import Aria2Dler
from app.lib.core.dl.model.dler_dl import DlDler
from app.lib.core.dl.model.dler_dl_single import DlSingleDler


@interRoot.bind("dl", "LIB_CORE")
class core_module_dl(interRoot):
    def __init__(self):
        self.WAYS = {"aria2": Aria2Dler, "dl": DlDler, "dl-single": DlSingleDler}
        self.modName = None
        self.mod = None
        self.sets = self.INS.conf.dict("biu_default")
        self.tasks = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=self.sets["biu"]["download"]["maxDownloading"])
        self.auto()

    def __del__(self):
        for key in self.tasks:
            self.cancel(key)
        self._pool.shutdown(False)

    def auto(self):
        mode = self.sets["biu"]["download"]["mode"] \
            if self.sets["biu"]["download"]["mode"] in self.WAYS \
            else "dl-single"
        if mode == "aria2":
            a2 = (self.sets["biu"]["download"]["aria2Host"].split(":"), self.sets["biu"]["download"]["aria2Secret"])
            self.WAYS[mode].HOST = a2[0][0]
            self.WAYS[mode].PORT = a2[0][1]
            self.WAYS[mode].SECRET = a2[1]
        self.mod = self.WAYS[mode]
        self.modName = mode
        return self

    def add(self, key, args):
        group = [self.mod(**kw) for kw in args]
        self._lock.acquire()
        self.tasks[key] = group
        self._lock.release()
        for obj in group:
            self._pool.submit(obj.run)
        return True

    def cancel(self, key):
        r = []
        if key in self.tasks:
            for x in self.tasks[key]:
                r.append(x.cancel())
        return r

    def status(self, key="__all__"):
        r = {}
        if key == "__all__":
            for x in self.tasks.copy():
                r[x] = (self._status(x))
        else:
            if key in self.tasks:
                return self._status(key)
        return r

    def _status(self, key):
        if key not in self.tasks:
            return []

        r = []
        group = self.tasks[key]
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
            for x in self.tasks:
                r[x] = (self._info(x))
        else:
            if key in self.tasks:
                return self._info(key)
        return r

    def _info(self, key):
        if key not in self.tasks:
            return {}

        totalSize = 0
        totalIngSize = 0
        totalIngSpeed = 0

        group = self.tasks[key]
        tmp = [obj.info() for obj in group]

        for x in tmp:
            totalSize += x["size"]
            totalIngSize += x["ingSize"]
            totalIngSpeed += x["ingSpeed"]

        return {
            "totalSize": totalSize,
            "totalIngSize": totalIngSize,
            "totalIngSpeed": totalIngSpeed,
            "tasks": tmp
        }
