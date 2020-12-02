import json
import time

import requests

from .dler import Dler


class Aria2Dler(Dler):
    HOST = "localhost"
    PORT = 6800
    SECRET = ""

    def __init__(self, url, folder="./downloads/", name=None, dlArgs=Dler.TEMP_dlArgs, dlRetryMax=2, callback=None):
        super(Aria2Dler, self).__init__(url, folder, name, dlArgs, dlRetryMax, callback)
        self._a2TaskID = -1
        self.args = {"dir": self._dlSaveDir, "max-tries": self._dlRetryMax, "check-certificate": False}
        if self._dlSaveName is not None:
            self.args["out"] = self._dlSaveName

    def run(self):
        args = self.args.copy()
        args.update(self._dlArgs["@aria2"])

        parms = [
            self._dlUrl if type(self._dlUrl) == list else [self._dlUrl],
            dict(args),
        ]

        msg = self.call(parms, "aria2.addUri")

        if "error" in msg:
            self.status(Dler.CODE_BAD_FAILED, True)
        else:
            self._a2TaskID = msg["result"]
            self.__monitor_schedule()

        self.callback()

    def __monitor_schedule(self):
        while self.status(Dler.CODE_GOOD_RUNNING) or self.status(Dler.CODE_WAIT):
            msg = self.tell_status()
            if "error" in msg or "result" not in msg:
                self.status(Dler.CODE_BAD_FAILED, True)
                break
            tmp = msg["result"]
            if self._dlSaveUri is None and int(tmp["totalLength"]) > 0:
                self._dlSaveUri = tmp["files"][0]["path"]
                self._dlSaveName = tmp["files"][0]["path"].split("/")[-1]
                self._dlFileSize = int(tmp["totalLength"])
                self.status(Dler.CODE_GOOD_RUNNING, True)
            self._stuIngFileSize = int(tmp["completedLength"])
            self._stuIngSpeed = int(tmp["downloadSpeed"])
            if self._stuIngFileSize == self._dlFileSize:
                self.status(Dler.CODE_GOOD_SUCCESS, True)
                break
            else:
                time.sleep(0.5)
        self._stuIngSpeed = 0

    def tell_status(self):
        return self.call([self._a2TaskID], "aria2.tellStatus")

    def pause(self):
        if self.isSuccess(self.call([self._a2TaskID], "aria2.pause")):
            self.status(Dler.CODE_WAIT_PAUSE, True)
            return True
        return False

    def unpause(self):
        if self.isSuccess(self.call([self._a2TaskID], "aria2.unpause")):
            self.status(Dler.CODE_GOOD_RUNNING, True)
            return True
        return False

    def cancel(self):
        if self.isSuccess(self.call([self._a2TaskID], "aria2.remove")):
            self.status(Dler.CODE_BAD_CANCELLED, True)
            return True
        return False

    def call(self, params, method):
        msg = {"error": "404 not found"}
        try:
            params.insert(0, "token:%s" % Aria2Dler.SECRET)
            jsonreq = {
                "jsonrpc": "2.0",
                "id": self._id,
                "method": method,
                "params": params,
            }
            rep = requests.post("http://%s:%s/jsonrpc" % (Aria2Dler.HOST, Aria2Dler.PORT), data=json.dumps(jsonreq))
            msg = json.loads(rep.text)
        finally:
            return msg

    def isSuccess(self, rep):
        if "error" in rep:
            return False
        elif "result" in rep:
            return True
        else:
            return False