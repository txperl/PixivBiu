from flask import request

from altfe.interface.root import interRoot


@interRoot.bind("arg", "LIB_STATIC")
class static_arg(object):
    @staticmethod
    def getArgs(method, li, way="GET"):
        rst = {"ops": {"method": method}, "fun": {}}
        data = request.args if way == "GET" else request.form
        for x in li:
            c = x.split("=")
            group = "fun"
            if c[0][:1] == "&":
                group = "ops"
                c[0] = c[0][1:]
            if not data.get(c[0]):
                if len(c) != 2:
                    raise AttributeError("missing parameters: %s" % c[0])
                rst[group][c[0]] = c[1]
            else:
                rst[group][c[0]] = data.get(c[0])
        return rst

    @staticmethod
    def argsPurer(fun, li):
        for x in li:
            fun[li[x]] = fun[x]
            del fun[x]
