import re
import traceback
import uuid


class Dler(object):
    """
    biu-dl 下载模块接口类
    """

    CODE_BAD = 0
    CODE_BAD_FAILED = (0, 0)
    CODE_BAD_CANCELLED = (0, 1)
    CODE_GOOD = 1
    CODE_GOOD_RUNNING = (1, 0)
    CODE_GOOD_SUCCESS = (1, 1)
    CODE_WAIT = 2
    CODE_WAIT_PAUSE = (2, 0)

    TEMP_dlArgs = {"_headers": {}, "@requests": {}, "@aria2": {}}

    def __init__(self, url, folder, name, dlArgs, dlRetryMax, callback):
        self._id = str(uuid.uuid1())
        self._dlUrl = url
        self._dlArgs = dlArgs
        self._dlFileSize = -1
        self._dlSaveUri = None
        self._dlSaveDir = folder
        self._dlSaveName = name
        self._dlRetryMax = dlRetryMax
        self._dlRetryNum = 0
        self._funCallback = callback
        self._stuING = 2
        self._stuExtra = -1
        self._stuIngFileSize = 0
        self._stuIngSpeed = 0
        self._errMsg = (0, "None")

    # 线程启动函数
    def run(self):
        return True

    def pause(self):
        if self.status(Dler.CODE_GOOD_RUNNING):
            return self.status(Dler.CODE_WAIT_PAUSE, True)
        return False

    def unpause(self):
        if self.status(Dler.CODE_WAIT):
            return self.status(Dler.CODE_GOOD_RUNNING, True)
        return False

    def cancel(self):
        if self.status(Dler.CODE_GOOD_RUNNING):
            return self.status(Dler.CODE_BAD_CANCELLED, True)
        return False

    # 下载任务信息
    def info(self):
        r = {
            "url": self._dlUrl,
            "size": self._dlFileSize,
            "saveDir": self._dlSaveDir,
            "saveName": self._dlSaveName,
            "retryNum": self._dlRetryNum,
            "ingSize": self._stuIngFileSize,
            "ingSpeed": self._stuIngSpeed
        }
        return r

    # 下载任务状态值
    def status(self, code, isBool=None):
        if isBool is True:
            if type(code) == tuple:
                self._stuING, self._stuExtra = code
            return True
        if type(code) != tuple and self._stuING == code:
            return True
        if type(code) == tuple and (self._stuING, self._stuExtra) == code:
            return True
        return False

    # 下载回调
    def callback(self):
        if self._funCallback is None:
            return
        r = [self._funCallback] if type(self._funCallback) is not list else self._funCallback
        for fun in r:
            if not hasattr(fun, "__call__"):
                return
            try:
                fun(self)
            except Exception:
                print(traceback.format_exc())

    @staticmethod
    def pure_size(size, dig=2, space=1):
        """
        格式化文件 size。
        :param size: int: 文件大小
        :param dig: int: 保留小数位数
        :param space: int: 大小与单位之间的空格数量
        :return:
        str: 格式化的 size，如 "1.23 MB"
        """
        units = ["B", "KB", "MB", "GB", "TB", "PB"]
        unit_index = 0
        K = 1024.0
        while size >= K:
            size = size / K
            unit_index += 1
        return ("%." + str(dig) + "f" + " " * space + "%s") % (size, units[unit_index])

    @staticmethod
    def get_dl_filename(url, headers):
        """
        获取预下载文件的名称，判断过程如下：
            1. 以 "/" 分割，若最后一项包含 "."，则返回该项
            2. 请求目标 url header，若 content-disposition 中存在 filename 项，则返回该项
            3. 若 1、2 皆未成功获取，则直接返回以 "/" 分割的最后一项
        :param url:  str: 目标 URL
        :param headers:  str: 请求头
        :return:
        str: 名称
        """
        urlLastPart = url.split("/")[-1]
        if "." in urlLastPart:
            return urlLastPart
        if "content-disposition" in headers:
            name = re.findall("filename=(.+)", headers["content-disposition"])[0]
            return re.sub(r"[\/\\\:\*\?\"\<\>\|]", "", name)
        return urlLastPart
