from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/update_token/", "PLUGIN")
class doUpdateToken(interRoot):
    def run(self, cmd):
        try:
            self.STATIC.arg.getArgs("update_token", li=["pass"], way="POST")
        except:
            return {"code": 0, "msg": "missing parameters"}
        return {
            "code": 1,
            "msg": self.CORE.biu.update_token(),
        }
