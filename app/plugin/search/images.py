import requests
from flask import request

from altfe.interface.root import interRoot


@interRoot.bind("api/biu/search/images/", "PLUGIN")
class searchImages(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("searchImages", ["url=no"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        image_url = str(args["fun"]["url"])
        image_file = request.files.get("image")
        if image_url == "no" and image_file is None:
            return {"code": 0, "msg": "need url or image file"}

        api_key = self.INS.conf.get("biu_default", "secret.key.apiSauceNAO")
        if api_key is None or api_key == "":
            return {"code": 0, "msg": "function offline"}

        params = {
            "output_type": 2,
            "dbmask": 96,
            "api_key": api_key
        }
        others = {}

        if image_url != "no":
            params.update({"url": image_url})
        else:
            others.update({"files": {"file": image_file}})
        if self.CORE.biu.proxy != "":
            others.update({"proxies": {"https": self.CORE.biu.proxy}})

        rep = requests.post("https://saucenao.com/search.php", timeout=10, params=params, **others).json()

        if rep["header"].get("status") != 0:
            if "anonymous" in rep["header"].get("message"):
                return {"code": 0, "msg": "wrong key"}
            return {"code": 0, "msg": rep["header"].get("message")}

        return {
            "code": 1,
            "msg": {
                "way": "searchImages",
                "args": args,
                "rst": rep,
            },
        }
