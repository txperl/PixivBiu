from altfe.interface.root import interRoot


@interRoot.bind("api/biu/get/language/", "PLUGIN")
class PluginBiuLanguage(interRoot):
    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("biu_language", ["theme", "code=_"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        theme = str(args["fun"]["theme"])
        code = str(args["fun"]["code"])

        tmp = self.INS.i18n.get_wrapper(None if code == "_" else code)

        return {"code": 1, "msg": tmp.get(f"theme.{theme}", default=None)}
