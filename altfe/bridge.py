import importlib.util
import os

from altfe.interface.root import classRoot


class bridgeInit(classRoot):
    """
    Altfe 模块加载与初始化核心。
    """

    def __init__(self):
        self.rootPath = self.getENV("rootPath")
        self.APP_PATH = {
            "static": self.rootPath + "app/lib/static/",
            "common": self.rootPath + "app/lib/common/",
            "core": self.rootPath + "app/lib/core/",
            "pre": self.rootPath + "app/pre/",
            "plugin": self.rootPath + "app/plugin/"
        }

    def run(self):
        self.loadAllModules()
        classRoot.mount(["LIB_STATIC", "LIB_COMMON"])
        classRoot.instantiate(["LIB_CORE", "PRE"])
        classRoot.mount(["LIB_CORE", "PRE", "PLUGIN"])

    def loadAllModules(self):
        conf = classRoot.loadConfig(classRoot.getENV("rootPath") + "app/config/switch.yml")["OnOff"]
        for dirName in self.APP_PATH:
            rPath = self.APP_PATH[dirName]
            files = os.listdir(rPath)
            for file in files:
                if dirName in conf and conf[dirName] is not None and file in conf[dirName]:
                    if not conf[dirName][file]:
                        continue
                r = rPath + file
                if os.path.isdir(r):
                    tmp = os.listdir(r)
                    if "main.py" in tmp:
                        r += "/main.py"
                    else:
                        continue
                elif file[-3:] != ".py":
                    continue
                spec = importlib.util.spec_from_file_location(dirName + "_" + file, r)
                cls = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(cls)
