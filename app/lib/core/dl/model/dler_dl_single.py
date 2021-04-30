import os
import time

import requests

from altfe.interface.root import interRoot
from app.lib.core.dl.model.dler import Dler


class DlSingleDler(Dler):
    def __init__(self, url, folder="./downloads/", name=None, dlArgs=Dler.TEMP_dlArgs, dlRetryMax=2, callback=None):
        super(DlSingleDler, self).__init__(url, folder, name, dlArgs, dlRetryMax, callback)
        if self._dlSaveName is None:
            try:
                headers = {}
                with requests.head(self._dlUrl, headers=self._dlArgs["_headers"], **self._dlArgs["@requests"],
                                   allow_redirects=True) as rep:
                    headers = rep.headers
            finally:
                self._dlSaveName = Dler.get_dl_filename(self._dlUrl, headers)
        self._dlSaveUri = os.path.join(self._dlSaveDir, self._dlSaveName)
        self._dlFileSize = -1
        interRoot.STATIC.file.mkdir(self._dlSaveDir)

    def run(self):
        self.status(Dler.CODE_GOOD_RUNNING, True)
        if self.__download_single():
            self.status(Dler.CODE_GOOD_SUCCESS, True)
        else:
            self.status(Dler.CODE_BAD_FAILED, True)
        self.callback()

    def __download_single(self):
        """
        单线程下载。
        :return:
        none
        """
        try:
            rep = requests.get(self._dlUrl, headers=self._dlArgs["_headers"], **self._dlArgs["@requests"], stream=True,
                               verify=False)
            with open(self._dlSaveUri, "wb", buffering=1024) as f:
                for chunk in rep.iter_content(chunk_size=2048):
                    # 若 CODE_BAD，则退出
                    if self.status(Dler.CODE_BAD):
                        return False
                    # 流写入
                    if chunk:
                        f.write(chunk)
                    # 若 CODE_WAIT，则等待
                    while self.status(Dler.CODE_WAIT):
                        time.sleep(1)
            return True
        except:
            return False
        finally:
            self._stuIngFileSize = -1
