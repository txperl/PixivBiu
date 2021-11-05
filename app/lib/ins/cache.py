import base64
import pickle
import threading
import time

from altfe.interface.root import interRoot


@interRoot.bind("cache", "LIB_INS")
class InsCache(object):
    def __init__(self):
        self._check_time = 5
        self._cache = {}
        self.lock = threading.Lock()
        self.auto()

    def auto(self):
        t = threading.Timer(0, self.__check)
        t.setDaemon(True)
        t.start()
        print("[cache] running")

    def set(self, key: str, value, expire=600, reset=True):
        self.lock.acquire()
        try:
            assert key != ""
            if key in self._cache and reset is not True:
                return True
            self._cache[key] = {}
            if not isinstance(value, bytes):
                self._cache[key]["bytes"] = 0
                value = pickle.dumps(value)
            else:
                self._cache[key]["bytes"] = 1
            self._cache[key]["value"] = base64.b64encode(value).decode("utf-8")
            self._cache[key]["ttl"] = (
                str(999999999) if expire == 0 else str(int(time.time()) + int(expire))
            )
            self._cache[key]["visnum"] = 0
        except:
            return None
        finally:
            self.lock.release()
        return True

    def get(self, key: str, itype="value", forceIncrement=False):
        try:
            assert key != "" and key in self._cache
            if itype == "value":
                value = base64.b64decode(str(self._cache[key][itype]).encode("utf-8"))
                if not self._cache[key]["bytes"]:
                    value = pickle.loads(value)
                self._cache[key]["visnum"] += 1
            else:
                value = self._cache[key][itype]
                if forceIncrement:
                    self._cache[key]["visnum"] += 1
            return value
        except:
            return None

    def delete(self, key):
        self.lock.acquire()
        try:
            if isinstance(key, dict):
                for x in key:
                    assert x != "" and x in self._cache
                    self._cache.pop(x)
            elif isinstance(key, str):
                assert key != "" and key in self._cache
                self._cache.pop(key)
            else:
                return False
        except:
            return False
        finally:
            self.lock.release()
        return True

    def clear(self):
        self.lock.acquire()
        self._cache = {}
        self.lock.release()

    def __check(self):
        try:
            tim = int(time.time())
            for key in self._cache:
                try:
                    if tim > int(self._cache[key]["ttl"]):
                        self.delete(key)
                except:
                    continue
        except:
            pass
        t = threading.Timer(self._check_time, self.__check)
        t.setDaemon(True)
        t.start()
