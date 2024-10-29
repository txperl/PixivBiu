import os
import threading
import time

import requests

from altfe.interface.root import interRoot
from app.lib.core.dl.model.dler import Dler

requests.packages.urllib3.disable_warnings()


class DlDler(Dler):
    def __init__(self, url, folder="./downloads/", name=None, dlArgs=Dler.TEMP_dlArgs, dlCacheDir=None, dlRetryMax=2,
                 callback=None, size=None, dlCacheBlockNum=6):
        super(DlDler, self).__init__(url, folder, name, dlArgs, dlRetryMax, callback)

        if dlCacheDir is None:
            self._dlCacheDir = os.path.join(self._dlSaveDir)
        else:
            self._dlCacheDir = dlCacheDir
        self._dlSaveName, self._dlFileSize = self.__get_dl_name_size(name, size)
        self._dlSaveUri = os.path.join(self._dlSaveDir, self._dlSaveName)
        self._dlCacheBlockNum = dlCacheBlockNum
        self._dlCacheBlockArr = self.__get_cache_blocks()

        interRoot.STATIC.file.mkdir(self._dlCacheDir)
        interRoot.STATIC.file.mkdir(self._dlSaveDir)

    def run(self):
        """
        单下载任务的启动函数。
        :return: none
        """
        # 判断是否超过最大尝试次数
        if self._dlFileSize == -1 or self._dlRetryNum > self._dlRetryMax:
            self.status(Dler.CODE_BAD_FAILED, True)
            return False

        # 开始下载
        threads = []
        threadIndex = 0
        # 以分块为单位启动线程
        for cacheUri, begin, end in self._dlCacheBlockArr:
            thread = threading.Thread(target=self.__thread_download, args=(cacheUri, begin, end, threadIndex))
            threads.append(thread)
            thread.setDaemon(True)
            thread.start()
            threadIndex += 1
        # 启动进度监控线程
        monitor = threading.Thread(target=self.__thread_monitor_schedule, args=())
        monitor.setDaemon(True)
        monitor.start()

        self.status(Dler.CODE_GOOD_RUNNING, True)
        # 阻塞
        for t in threads:
            t.join()

        # 合并
        if self.__merge():
            # 下载成功
            self.status(Dler.CODE_GOOD_SUCCESS, True)
            self.callback()
            self.clear_cache()
        else:
            # 数据合并失败，开始重试
            if self.status(Dler.CODE_BAD_CANCELLED):
                self._dlRetryNum += self._dlRetryMax
            else:
                self._dlRetryNum += 1
            self.callback()
            self.run()

    def clear_cache(self, isAllCache=False):
        if isAllCache:
            interRoot.STATIC.file.clearDIR(self._dlCacheDir)
        else:
            interRoot.STATIC.file.rm([x[0] for x in self._dlCacheBlockArr])

    def __merge(self):
        """
        合并分块文件。
        :return:
        none
        """
        if self.status(Dler.CODE_BAD):
            return False

        isDone = True

        # 若存在同名目标文件，则删除
        interRoot.STATIC.file.rm(self._dlSaveUri)

        # 合并
        with open(self._dlSaveUri, "ab") as rst:
            for i in range(self._dlCacheBlockNum):
                cacheUri, begin, end = self._dlCacheBlockArr[i]
                # 判断分块文件大小是否正确
                if os.path.getsize(cacheUri) != (end - begin + 1):
                    isDone = False
                    break
                # 写入数据
                with open(cacheUri, "rb") as f:
                    rst.write(f.read())
        return isDone

    def __thread_download(self, cacheUri, begin, end, index):
        """
        分块下载线程函数
        :param begin: int: 分块文件序号头
        :param end:  int: 分块文件序号尾
        :param index:  int: 分块序号
        :return:
        none
        """
        hopeFileSize = end - begin + 1  # 本次任务分块总大小

        try:
            # 判断已下载分块大小
            if os.path.exists(cacheUri):
                existFileSize = os.path.getsize(cacheUri)
            else:
                existFileSize = 0

            # 判断已下载文件大小是否与期望大小相同
            if hopeFileSize - existFileSize > 0:
                headers = {
                    "Range": "Bytes=%d-%s" % (existFileSize + int(begin), end),
                    "Accept-Encoding": "*",
                }
                headers.update(self._dlArgs["_headers"])

                rep = requests.get(self._dlUrl, headers=headers, **self._dlArgs["@requests"], stream=True)
                with open(cacheUri, "ab", buffering=1024) as f:
                    for chunk in rep.iter_content(chunk_size=2048):
                        # 若 CODE_BAD，则退出
                        if self.status(Dler.CODE_BAD):
                            break
                        # 流写入
                        if chunk:
                            existFileSize += len(chunk)
                            f.write(chunk)
                        # 若 CODE_WAIT，则等待
                        while self.status(Dler.CODE_WAIT):
                            time.sleep(1)
            return True
        except:
            return False

    def __thread_monitor_schedule(self):
        """
        下载进度、速度监控线程。通过获取目标文件大小来判断进度、速度。
        :return:
        none
        """
        prevFileSize = 0
        while self.status(Dler.CODE_GOOD_RUNNING) or self.status(Dler.CODE_WAIT):
            sumSize = 0
            try:
                for cacheUri, begin, end in self._dlCacheBlockArr:
                    sumSize += os.path.getsize(cacheUri)
            except:
                continue
            self._stuIngFileSize = sumSize
            self._stuIngSpeed = sumSize - prevFileSize
            prevFileSize = sumSize
            time.sleep(1)
        if self.status(Dler.CODE_GOOD_SUCCESS):
            self._stuIngFileSize = self._dlFileSize
            self._stuIngSpeed = 0

    def __get_dl_name_size(self, name, size):
        """
        自动判断预下载文件的名称与大小。若目标服务器不返回相关大小，则启用单线程下载。
        :return:
        tuple: (str: name, int: length)
        """
        if name is not None and size is not None:
            return name, size
        contentName = name
        contentLength = -1
        try:
            with requests.head(self._dlUrl, headers=self._dlArgs["_headers"], **self._dlArgs["@requests"],
                               allow_redirects=True) as rep:
                # 获取文件名称
                if name is None:
                    contentName = Dler.get_dl_filename(self._dlUrl, rep.headers)
                # 获取文件大小
                if size is None and "Content-Length" in rep.headers:
                    contentLength = int(rep.headers["Content-Length"])
                if rep.url != self._dlUrl:
                    self._dlUrl = rep.url
        finally:
            return contentName, contentLength

    def __get_cache_blocks(self):
        """
        根据 预下载文件大小 与 设置的分块数 得到各分块大小。
        :return:
        list[(begin, end), (), ...]: 分块序列列表
        """
        if self._dlFileSize == -1:
            return [(self._dlSaveUri, -1, -1)]

        r = []
        offset = int(self._dlFileSize / self._dlCacheBlockNum)
        for i in range(self._dlCacheBlockNum):
            # 分块缓存名称、路径
            tmp = [os.path.join(self._dlCacheDir, ("%s.p%s" % (self._dlSaveName, str(i))))]
            if i == self._dlCacheBlockNum - 1:
                r.append(tuple(tmp + [i * offset, self._dlFileSize - 1]))
            else:
                r.append(tuple(tmp + [i * offset, (i + 1) * offset - 1]))
        return r
