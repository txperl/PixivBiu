import traceback

from altfe.interface.root import classRoot


class handleRoute(classRoot):
    """
    Altfe 指令处理核心。
    """

    @classmethod
    def do(cls, cmd):
        # 指令选择
        rCMD = cmd
        if cmd not in cls.AVALS["PLUGIN"]:
            rCMD = None
            for x in cls.AVALS["PLUGIN"]:
                if x == cmd[:len(x)]:
                    rCMD = x
                    break
            if rCMD is None:
                return {"code": 0, "msg": "no method"}

        # 执行预处理函数
        # preFuns = cls.osGet("PRE")
        # for name in preFuns:
        #     if not preFuns[name].run(rCMD):
        #         return {"code": 403, "msg": f"[PRE] Forbidden by {name}"}

        # 执行指令并返回
        try:
            r = cls.osGet("PLUGIN", rCMD)().run(cmd.split(rCMD)[1])
            return r
        except:
            cls.STATIC.localMsger.error(traceback.format_exc())

        return {"code": 500, "msg": "plugin error"}
