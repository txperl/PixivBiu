import ast
import errno

from altfe.interface.root import interRoot


class ConfigWrapper(object):
    """
    配置、语言文件的通用包装器，用于基础的格式化、获取、修改、转换等操作。
    可格式化「平坦、平坦-字典、字典」三种格式的文本内容，但最终将全部转换为字典数据结构进行存储。
    """
    SIGN_EMPTY = "__rm__"

    def __init__(self, path=None, config=None, error=True):
        if config is None:
            config = interRoot.loadConfig(path)
            if config is False or config is None:
                if error:
                    raise FileNotFoundError(errno.ENOENT, "Cannot load the language file", path)
                else:
                    config = {}
        self._configDict = ConfigWrapper.format2dict(config)

    def format2flat(self, dic=None, finalKeys=None):
        """
        将 dic 的字典数据结构平坦化，如 dic["a"]["b"] -> dic["a.b"]。
        :param dic: 字典数据
        :param finalKeys: 递归使用，记录当前层级 key
        :return: 平坦化的字典
        """
        if dic is None:
            dic = self._configDict
        if finalKeys is None:
            finalKeys = []
        r = {}
        for key in dic:
            item = dic[key]
            if type(item) != dict:
                r.update({".".join(finalKeys + [str(key)]): item})
            else:
                r.update(self.format2flat(item, finalKeys + [str(key)]))
        return r

    def dict(self):
        """
        对原 config 拷贝后返回。
        :return: config.copy()
        """
        return self._configDict.copy()

    def get(self, key: str, default=None):
        """
        获取 config 中的值。
        :param key: 以 "." 连接的多层级键，如 "a.b" 代表 dict["a"]["b"]
        :param default: 若值不存在，则默认返回此字段
        :return: value or default
        """
        now = self._configDict
        for subKey in key.split("."):
            if subKey not in now:
                return default
            now = now[subKey]
        return now if now != ConfigWrapper.SIGN_EMPTY else default

    def update_dict(self, dic: dict):
        """
        更新 config 字典，与 python dict update 功能相同。
        :param dic: 需要更新的信息
        :return: none
        """
        self._configDict.update(dic)

    def set(self, key: str, value: any, strict=False):
        """
        设置 config 中的值。
        :param key: 以 "." 连接的多层级键，如 "a.b" 代表 dict["a"]["b"]
        :param value: 值
        :param strict: 是否以严格模式进行。若是，则若键不存在会返回 false；若否，则若字段不存在会创建新键
        :return: true or false
        """
        now = self._configDict
        keys = key.split(".")
        for i in range(len(keys) - 1):
            nowKey = keys[i]
            if nowKey not in now:
                if strict:
                    return False
                else:
                    now.update({nowKey: {}})
            now = now[nowKey]
        now.update({keys[-1]: value})
        return True

    def remove(self, key: str):
        """
        移除 config 中的值。
        :param key: 以 "." 连接的多层级键，如 "a.b" 代表 dict["a"]["b"]
        :return: true or false
        """
        return self.set(key, value=ConfigWrapper.SIGN_EMPTY, strict=True)

    @staticmethod
    def format2dict(configFlat):
        """
        将三种类型的初始化字典转化为最终字典。
        :param configFlat: 待转换的字典
        :return: 最终字典
        """
        r = {}
        for key in configFlat:
            keys = key.split(".")
            now = r
            for i in range(len(keys)):
                subKey = keys[i]
                if i == len(keys) - 1:
                    now.update({subKey: configFlat[key]})
                    break
                if subKey not in now:
                    now.update({subKey: {}})
                now = now[subKey]
        return r

    @staticmethod
    def literal_eval(_: str):
        if _ == "false":
            return False
        if _ == "true":
            return True
        try:
            return ast.literal_eval(_)
        except:
            return _
