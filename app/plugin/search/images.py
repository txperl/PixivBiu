import json

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

        api_key = self.INS.conf.get("biu_default", "secret.key.apiSauceNAO")
        if api_key is None or api_key == "":
            return {"code": 0, "msg": "function offline"}

        image_url = str(args["fun"]["url"])
        image_file = request.files.get("image")
        if image_url == "no" and image_file is None:
            return {"code": 0, "msg": "need url or image file"}

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

        rep = requests.post("https://saucenao.com/search.php", params=params, **others)

        return {
            "code": 1,
            "msg": {
                "way": "search",
                "args": args,
                "rst": json.loads(rep.text),
            },
        }
