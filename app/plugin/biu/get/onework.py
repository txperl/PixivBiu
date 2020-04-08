# coding=utf-8
# pylint: disable=relative-beyond-top-level
from ....platform import CMDProcessor
import requests
import json


@CMDProcessor.plugin_register("api/biu/get/onework")
class getRank(object):
    def __init__(self, MOD):
        self.MOD = MOD
        self.code = 1

    def pRun(self, cmd):
        try:
            args = self.MOD.args.getArgs(
                "oneWork", ["workID", "&totalPage=all", "&groupIndex=all"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": self.code,
            "msg": {
                "way": "get",
                "args": args,
                "rst": self.one(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def one(self, opsArg, funArg):
        r = self.MOD.biu.apiAssist.illust_detail(funArg["workID"])

        if "illust" not in r:
            self.code = 0
            return "error"
        r = [r["illust"]]

        self.MOD.biu.appWorksPurer(r)

        if len(r[0]["all"]["meta_pages"]) > 0:
            num = len(r[0]["all"]["meta_pages"])
            for i in range(1, num):
                r += [r[0].copy()]
                del r[i]['image_urls']
                r[i]['image_urls'] = {}
                r[i]["image_urls"]["small"] = r[i]["all"]["meta_pages"][i]["image_urls"][
                    "square_medium"
                ]
                r[i]["image_urls"]["medium"] = r[i]["all"]["meta_pages"][i]["image_urls"][
                    "medium"
                ]
                r[i]["image_urls"]["large"] = r[i]["all"]["meta_pages"][i]["image_urls"][
                    "large"
                ]
                r[i]['title'] = '~' + str(i)

        return {"api": "app", "data": r}
