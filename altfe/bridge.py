import importlib.util
import os
import random
import string

from altfe.interface.root import classRoot


class bridgeInit(classRoot):
    """
    Altfe 模块加载与初始化核心。
    """

    def __init__(self):
        self.rootPath = self.getENV("rootPathFrozen")
        self.APP_PATH = {
            "ins": self.rootPath + "app/lib/ins/",
            "static": self.rootPath + "app/lib/static/",
            "common": self.rootPath + "app/lib/common/",
            "core": self.rootPath + "app/lib/core/",
            "plugin": self.rootPath + "app/plugin/"
        }

    def run(self, hint=False):
        if hint:
            print("[Altfe] ;)")
        bridgeInit.load_all(self.read_all_modules())
        classRoot.mount(["LIB_STATIC"])
        classRoot.instantiate(["LIB_INS"])
        classRoot.mount(["LIB_INS", "LIB_COMMON"])
        classRoot.instantiate(["LIB_CORE", "PRE"])
        classRoot.mount(["LIB_CORE", "PRE", "PLUGIN"])

    def read_all_modules(self):
        r = []
        conf = {}
        for moduleType in self.APP_PATH:
            rootModulePath = self.APP_PATH[moduleType]
            files = os.listdir(rootModulePath)
            files.sort()
            for fileName in files:
                # skip
                if not bridgeInit.is_load(conf, moduleType, fileName):
                    continue
                # read
                moduleName = "%s_%s_%s" % (moduleType, "".join(
                    random.SystemRandom().choice(string.ascii_uppercase + string.digits) for _ in range(5)), fileName)
                filePath = rootModulePath + fileName
                # dir handle
                if os.path.isdir(filePath):
                    filePath += "/"
                    tmp = os.listdir(filePath)
                    if "main.py" in tmp:
                        r.append([moduleName, filePath + "main.py"])
                    else:
                        for x in tmp:
                            if x[-3:] == ".py" and bridgeInit.is_load(conf, moduleType, x):
                                r.append([moduleName, filePath + x])
                elif fileName[-3:] == ".py":
                    r.append([moduleName, filePath])
        return r

    @staticmethod
    def is_load(conf, moduleType, fileName):
        if moduleType in conf and conf[moduleType] is not None and fileName in conf[moduleType]:
            if not conf[moduleType][fileName]:
                return False
        return True

    @staticmethod
    def load_all(modules):
        for x in modules:
            bridgeInit.load_single(*x)

    @staticmethod
    def load_single(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        cls = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls)
