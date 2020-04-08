# coding=utf-8
# pylint: disable=relative-beyond-top-level,unused-wildcard-import
from ...platform import CMDProcessor
from flask import request


@CMDProcessor.core_register('args')
class core_module_param(object):
    def __init__(self):
        self.header = {}
        self.get = {}
        self.post = {}
        self.error = 0
        self.msgCode = {'stu': 'error', 'msg': 'no'}

    def check(self, **kw):
        if 'header' in kw:
            for x in kw['header']:
                if request.headers.get(x) == None:
                    self.error = 1
                else:
                    self.get[x] = request.headers.get(x)

        if 'get' in kw:
            for x in kw['get']:
                if request.args.get(x) == None:
                    self.error = 1
                else:
                    self.get[x] = request.args.get(x)

        if 'post' in kw:
            for x in kw['post']:
                if request.form.get(x) == None:
                    self.error = 1
                else:
                    self.get[x] = request.form.get(x)

    def getParams(self):
        if self.error == 0:
            return {'header': self.header, 'get': self.get, 'post': self.post}
        else:
            return self.msgCode
    
    def getArgs(self, method, li):
        rst = {"ops": {"method": method}, "fun": {}}
        for x in li:
            c = x.split("=")
            group = "fun"
            if c[0][:1] == "&":
                group = "ops"
                c[0] = c[0][1:]
            if not request.args.get(c[0]):
                if len(c) == 2:
                    rst[group][c[0]] = c[1]
                else:
                    raise AttributeError("missing parameters: %s" % c[0])
            else:
                rst[group][c[0]] = request.args.get(c[0])
        return rst
    
    def argsPurer(self, fun, li):
        for x in li:
            fun[li[x]] = fun[x]
            del fun[x]