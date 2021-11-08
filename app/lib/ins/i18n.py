import locale
import os

from altfe.interface.root import classRoot
from app.lib.ins.conf.wrapper import ConfigWrapper


@classRoot.bind("i18n", "LIB_INS")
class InsI18n(classRoot):
    def __init__(self):
        self.rootLangFolderPath = self.getENV("rootPathFrozen") + "app/config/language/"
        self.langCode = self.__deter_lang_code()
        self._lang = ConfigWrapper(self.rootLangFolderPath + self.langCode + ".yml", error=False)

    def __deter_lang_code(self, code_=None):
        """
        Determine the language code({ISO 639-1}-{ISO 3166-1}).
        If code_ is None, it will recognize the local language of the system automatically. Default is 'en'.
        :param: code_: language code
        :return: final code
        """
        if code_ is not None:
            code = code_
        else:
            code = classRoot.osGet("LIB_INS", "conf").get("biu_default", "sys.language", "")
        if code == "":
            code, _ = locale.getdefaultlocale()
            code = "en" if code is None else code.replace("_", "-")
        if not os.path.exists(self.rootLangFolderPath + code + ".yml"):
            code = code.split("-")[0]
            if not os.path.exists(self.rootLangFolderPath + code + ".yml"):
                code = "en"
        return code

    def get_wrapper(self, code_=None):
        """
        Get the language's ConfigWrapper object(original type).
        :param code_: language code
        :return: ConfigWrapper object
        """
        if code_ is None:
            return self._lang
        code = self.__deter_lang_code(code_)
        return ConfigWrapper(self.rootLangFolderPath + code + ".yml")

    def get_bundle(self, beforeKey, default=None, func=True):
        """
        Get the bundle of one language.
        :param beforeKey: father key
        :param default: default value
        :param func: weather to return a lambda function
        :return: dict or lambda function
        """
        if func:
            return lambda key: self.get(f"{beforeKey}.{key}", default=default)
        else:
            return self.get(beforeKey, default=default)

    def get(self, key, default=None):
        """
        Get the language text.
        :param key: key of the text in the language file
        :param default: default value
        :return: any
        """
        if default is None:
            default = "{" + key + "}"
        return self._lang.get(key, default=default)
