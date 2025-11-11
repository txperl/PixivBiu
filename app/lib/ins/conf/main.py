import os

from altfe.interface.root import interRoot
from app.lib.ins.conf.wrapper import ConfigWrapper


@interRoot.bind("conf", "LIB_INS")
class InsConf(interRoot):
    def __init__(self):
        self.rootConfigFolderPath = self.getENV("rootPathFrozen") + "app/config/"
        self.customConfigPath = self.getENV("rootPath") + "config.yml"
        self._configs = {}
        self._dictWrapper = {}
        self.load_config()

    def load_config(self):
        """
        Loads all files(.yml, .yaml) in './app/config/' folder.
        Then, load or create the user's customized config file(./config.yml).
        :return: none
        """
        self._configs.update({"config": ConfigWrapper(path=self.customConfigPath, error=False)})
        for fileName in os.listdir(self.rootConfigFolderPath):
            if ".yml" in fileName or ".yaml" in fileName:
                fileName_ = ".".join(fileName.split(".")[:-1])
                self._configs.update({fileName_: ConfigWrapper(self.rootConfigFolderPath + fileName)})
                self.dict(fileName_, wrapper=True, reload=True)

    def dict(self, configName: str, flat=False, wrapper=False, reload=False):
        """
        Export the final dict data that includes customized and default configs.
        Of course, if the customized setting item conflicts with the default, only the customized one is retained.
        Environment > Custom > Default.
        :param configName: name of config file(the same with "./app/config/xxx.yml"), customized one is called "config"
        :param flat: weather to return a flat-like dict
        :param wrapper: weather to return a wrapper object
        :param reload: weather to reload
        :return: final config dict
        """
        if self._dictWrapper.get(configName) is None or reload is True:
            # load default config
            defaultDic = self.get_wrapper(configName)
            if defaultDic is None:
                return None
            # generate final config wrapper
            finalDic = ConfigWrapper(config=defaultDic.dict(), error=False)
            for key in defaultDic.format2flat():
                maybe = ConfigWrapper.SIGN_EMPTY
                # load environment variable config
                envVar = os.environ.get(key, ConfigWrapper.SIGN_EMPTY)
                if envVar == ConfigWrapper.SIGN_EMPTY:
                    envVar = os.environ.get(key.replace(".", "_").upper(), default=ConfigWrapper.SIGN_EMPTY)
                if envVar != ConfigWrapper.SIGN_EMPTY:
                    maybe = ConfigWrapper.literal_eval(envVar)
                else:
                    # load customized config
                    customVar = self.get_wrapper("config").get(key, default=ConfigWrapper.SIGN_EMPTY)
                    if customVar != ConfigWrapper.SIGN_EMPTY:
                        maybe = customVar
                if maybe != ConfigWrapper.SIGN_EMPTY:
                    finalDic.set(key, maybe)
            self._dictWrapper[configName] = finalDic
        else:
            # load the cache
            finalDic = self._dictWrapper[configName]
        if flat is True:
            return finalDic.format2flat()
        if wrapper is True:
            return finalDic
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
        dic = self.dict(configName, wrapper=True)
        if dic is None:
            return default
        return dic.get(key, default=default)

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
