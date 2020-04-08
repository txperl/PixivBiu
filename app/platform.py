# coding=utf-8
import traceback
import json
import yaml
import sys
import os

ENVIRON = {"ROOTPATH": os.path.split(os.path.realpath(sys.argv[0]))[0] + "/"}


class CMDProcessor(object):
    PLUGINS = {}
    CORES_LIST = []

    def process(self, cmd):
        if not cmd in self.PLUGINS.keys():
            return {"code": 0, "msg": "no method"}

        for x in self.CORES_LIST:
            f = getattr(self, x)()
            setattr(self, x, f)
        self.ENVIRON = ENVIRON

        try:
            r = self.PLUGINS[cmd](self).pRun(cmd)
            return r
        except Exception as e:
            print("[system] Plugin \033[1;37;46m %s \033[0m failed to run" % cmd)
            print("\033[31m[ERROR] %s\033[0m" % e)
            print("\033[31m%s\033[0m" % traceback.format_exc())

        return {"code": 0, "msg": "plugin error"}

    @classmethod
    def plugin_register(cls, plugin_name):
        def wrapper(plugin):
            cls.PLUGINS.update({plugin_name: plugin})
            return plugin

        return wrapper

    @classmethod
    def core_register(cls, core_name):
        def wrapper(core):
            setattr(cls, core_name, core)
            cls.CORES_LIST.append(core_name)
            return core

        return wrapper

    @classmethod
    def core_register_auto(cls, core_name, loads={}):
        info = {"ENVIRON": ENVIRON}
        for x in loads:
            info[x] = cls.loadSet(loads[x])

        def wrapper(core):
            try:
                setattr(cls, core_name, core(info).auto())
            except Exception as e:
                print(
                    "[system] Core \033[1;37;46m %s \033[0m failed to load" % core_name
                )
                print("\033[31m[ERROR] %s\033[0m" % e)
                print("\033[31m%s\033[0m" % traceback.format_exc())
            return core

        return wrapper

    @staticmethod
    def getEnv():
        return ENVIRON

    @staticmethod
    def loadSet(uri):
        uri = uri.replace("{ROOTPATH}", ENVIRON["ROOTPATH"])
        try:
            with open(uri, "r", encoding="UTF-8") as c:
                sfx = uri.split(".")[-1]
                if sfx == "json":
                    return json.load(c)
                elif sfx == "yml" or sfx == "yaml":
                    return yaml.safe_load(c)
                else:
                    return c
        except Exception as e:
            print("[system] \033[1;37;46m %s \033[0m failed to load" % uri)
            print("\033[31m[ERROR] %s\033[0m" % e)
            print("\033[31m%s\033[0m" % traceback.format_exc())
        return None

