import os

from altfe.interface.root import interRoot
from app.lib.ins.conf.wrapper import ConfigWrapper


@interRoot.bind("conf", "LIB_INS")
class InsConf(interRoot):
    def __init__(self):
        self.rootConfigFolderPath = self.getENV("rootPathFrozen") + "app/config/"
        self.customConfigPath = self.getENV("rootPath") + "config.yml"
        self._configs = {}
        self.load_config()

    def load_config(self):
        """
        Loads all files(.yml, .yaml) in './app/config/' folder.
        Then, load or create the user's customized config file(./config.yml).
        :return: none
        """
        for fileName in os.listdir(self.rootConfigFolderPath):
            if ".yml" in fileName or ".yaml" in fileName:
                fileName_ = ".".join(fileName.split(".")[:-1])
                self._configs.update({fileName_: ConfigWrapper(self.rootConfigFolderPath + fileName)})
        self._configs.update({"config": ConfigWrapper(path=self.customConfigPath, error=False)})

    def dict(self, configName: str, flat=False):
        """
        Export the final dict data that includes customized and default configs.
        Of course, if the customized setting item conflicts with the default, only the customized one is retained.
        Environment > Custom > Default.
        :param configName: name of config file(the same with "./app/config/xxx.yml"), customized one is called "config"
        :param flat: weather to be formatted as a flat-like dict
        :return: final config dict
        """
        defaultDic = self.get_wrapper(configName)
        if defaultDic is None:
            return None
        finalDic = ConfigWrapper(config=defaultDic.dict(), error=False)
        for key in defaultDic.format2flat():
            maybe = self.get("config", key, default=ConfigWrapper.SIGN_EMPTY)
            if maybe != ConfigWrapper.SIGN_EMPTY:
                finalDic.set(key, maybe)
        if flat is True:
            return finalDic.format2flat()
        return finalDic.dict()

    def get_wrapper(self, configName: str, default=None):
        """
        Get the config's ConfigWrapper object(original type).
        :param configName: name of config file
        :param default: the default value returned if the key doesn't exist
        :return: ConfigWrapper object or $default$
        """
        if configName in self._configs:
            return self._configs[configName]
        return default

    def get_bundle(self, configName: str, beforeKey: str, default=None, func=True):
        """
        Get the bundle of config.
        :param configName: name of config file
        :param beforeKey: header
        :param default: default value
        :param func: weather to return a lambda function
        :return: dict or lambda function
        """
        if func:
            return lambda key: self.get(configName, f"{beforeKey}.{key}", default=default)
        else:
            return self.get(configName, beforeKey, default=default)

    def get(self, configName: str, key: str, default=None):
        """
        Get the setting item via $subKey$ in the config called $key$.
        If there is a hierarchical relationship in the subKey, use dot instead. E.g, ["a"]["b"] -> "a.b".
        If the setting item exists in customized config, system will return it instead of the one in default config.
        Environment > Custom > Default.
        :param configName: name of config file
        :param key: key of the setting item in the dict
        :param default: the default value returned if the key doesn't exist
        :return: the value of setting item
        """
        envVar = os.environ.get(key, ConfigWrapper.SIGN_EMPTY)
        if envVar != ConfigWrapper.SIGN_EMPTY:
            if envVar in ("true", "false"):
                envVar = True if envVar == "true" else False
            return envVar
        defaultDic = self.get_wrapper(configName)
        if defaultDic is None:
            return default
        customRst = self.get_wrapper("config").get(key)
        if customRst is None:
            return defaultDic.get(key, default)
        return customRst

    def set(self, key: str, value: any):
        """
        Set the value of setting item.
        :param key: key of the setting item in the dict
        :param value: new value
        :return: true or false
        """
        return self.get_wrapper("config").set(key, value)

    def remove(self, key: str):
        """
        Remove/Delete the setting item.
        :param key: key of the setting item in the dict
        :return: true or false
        """
        return self.get_wrapper("config").remove(key)
