import json
import os

import yaml


class classEmpty(object):
    pass


class classRoot(object):
    """
    根类，存储环境变量以及所有模块。
    """
    __ENV = {}
    __MODULE = {
        "LIB_STATIC": {},
        "LIB_COMMON": {},
        "LIB_CORE": {},
        "PRE": {},
        "PLUGIN": {}
    }
    AVALS = {
        "PRE": [],
        "PLUGIN": []
    }

    @classmethod
    def setENV(cls, key, val):
        cls.__ENV[key] = val

    @classmethod
    def getENV(cls, key):
        if key in cls.__ENV:
            return cls.__ENV[key]
        return None

    @classmethod
    def osGet(cls, key, name=None):
        if key in cls.__MODULE:
            if name is None:
                return cls.__MODULE[key]
            elif name in cls.__MODULE[key]:
                return cls.__MODULE[key][name]
        return None

    @classmethod
    def instantiate(cls, keys=None):
        if keys is None:
            keys = cls.__MODULE.keys()
        for key in keys:
            if key not in cls.__MODULE:
                continue
            for name in cls.__MODULE[key]:
                cls.__MODULE[key][name] = cls.__MODULE[key][name]()

    @classmethod
    def mount(cls, keys=None):
        if keys is None:
            keys = cls.__MODULE.keys()
        for key in keys:
            if key not in cls.__MODULE:
                continue
            if "LIB_" in key:
                obj = classEmpty()
                for name in cls.__MODULE[key]:
                    setattr(obj, name, cls.__MODULE[key][name])
                setattr(cls, key[4:], obj)
            elif key in ("PRE", "PLUGIN"):
                cls.AVALS[key] = cls.__MODULE[key].keys()

    @classmethod
    def bind(cls, moduleName, key):
        if key not in cls.__MODULE:
            return

        def wrapper(module):
            cls.__MODULE[key].update({moduleName: module})

        return wrapper

    @staticmethod
    def loadConfig(uri):
        if not os.path.exists(uri):
            return False
        with open(uri, "r", encoding="UTF-8") as f:
            sfx = uri.split(".")[-1]
            if sfx == "json":
                return json.load(f)
            elif sfx == "yml" or sfx == "yaml":
                return yaml.safe_load(f)
            else:
                return f.read()


class interRoot(classRoot):
    """
    通用接口根类。
    """

    @classmethod
    def osGet(cls):
        return

    @classmethod
    def instantiate(cls):
        return

    @classmethod
    def mount(cls):
        return
