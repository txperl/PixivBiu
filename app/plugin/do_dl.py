import json
import os
import re
import time

from altfe.interface.root import interRoot


@interRoot.bind("api/biu/do/dl/", "PLUGIN")
class doDownload(interRoot):
    def __init__(self):
        self.code = 1

    def run(self, cmd):
        try:
            args = self.STATIC.arg.getArgs("dl", ["kt", "workID=0", "data=0"])
        except:
            return {"code": 0, "msg": "missing parameters"}

        if args["fun"]["workID"] == 0 and args["fun"]["data"] == 0:
            return {"code": 0, "msg": "missing parameters"}

        return {
            "code": self.code,
            "msg": {
                "way": "do",
                "args": args,
                "rst": self.dl(args["ops"].copy(), args["fun"].copy()),
            },
        }

    def dl(self, opsArg, funArg):
        if funArg["data"] == 0:
            r = self.CORE.biu.apiAssist.illust_detail(funArg["workID"])
            if "illust" not in r:
                self.code = 0
                return "error"
            r = r["illust"]
        else:
            r = json.loads(funArg["data"])

        if r["type"] != "illust" and r["type"] != "manga" and r["type"] != "ugoira":
            self.code = 0
            return "only support illustration, manga and ugoira"

        isSingle = len(r["meta_pages"]) == 0
        rootURI = (
            self.CORE.biu.sets["biu"]["download"]["saveURI"]
                .replace("{ROOTPATH}", self.getENV("rootPath"))
                .replace("{HOMEPATH}", os.path.expanduser('~') + "/")
                .replace("{KT}", self.__pureName(funArg["kt"]))
        )

        if rootURI[-1] != "/":
            rootURI = rootURI + "/"

        rootURI = self.__deName(rootURI, r)
        picTitle = self.__pureName(
            self.__deName(self.CORE.biu.sets["biu"]["download"]["saveFileName"], r)
        )

        status = []

        if r["type"] != "ugoira" and isSingle:
            # 单图下载
            url = r["meta_single_page"]["original_image_url"].replace(
                "https://i.pximg.net", self.CORE.biu.pximgURL
            )
            suf = r["meta_single_page"]["original_image_url"].split(".")[-1]
            status.append(self.getTemp(url, folder=rootURI, name=picTitle, suf=f".{suf}", type_="file"))
        elif r["type"] != "ugoira" and not isSingle:
            # 多图下载
            # 判断是否自动归档
            if self.CORE.biu.sets["biu"]["download"]["autoArchive"]:
                ext = picTitle + "/"
                mod = "folder"
                new = self.STATIC.file.md5(StringList=[ext, time.time()])
            else:
                ext = ""
                mod = "file"
                new = None
            for index in range(len(r["meta_pages"])):
                x = r["meta_pages"][index]
                picURL = x["image_urls"]["original"]
                url = picURL.replace("https://i.pximg.net", self.CORE.biu.pximgURL)
                suf = picURL.split(".")[-1]
                id_ = str(r["id"]) if (index + 1 == len(r["meta_pages"])) else "%end%"
                status.append(
                    self.getTemp(url, folder=rootURI + ext, name=f"{picTitle}_{str(index)}", suf=f".{suf}", type_=mod,
                                 id_=id_, tmp_name=new)
                )
        else:
            # 动图下载
            zipUrl, r_ = self.__getdlUgoiraPicsUrl(r["id"])
            wholePath = rootURI + picTitle + "/"
            temp = self.getTemp(zipUrl, folder=wholePath, name="ugoira", suf=".zip", fun=self.__callback_merge,
                                type_="folder")
            temp["dlArgs"]["@ugoira"] = {
                "r": r_,
                "name": picTitle
            }
            status.append(temp)

        if self.CORE.dl.add(str(r["id"]), status):
            return "running"
        else:
            return False

    def getTemp(self, url, folder, name, suf="", fun=None, id_="-1", type_="file", tmp_name=None,
                no_deter_the_same=False):
        folder = folder.replace("\\\\", "/").replace("\\", "/").replace("//", "/")
        r = {
            "url": url,
            "folder": folder,
            "name": name + suf,
            "dlArgs": {
                "_headers": {
                    "referer": "https://app-api.pixiv.net/"
                },
                "@requests": {
                    "proxies": {"https": self.CORE.biu.proxy}
                },
                "@aria2": {
                    "referer": "https://app-api.pixiv.net/",
                    "all-proxy": self.CORE.biu.proxy
                }
            },
            "callback": fun
        }
        deterPath = folder + name + suf if type_ == "file" else folder
        if no_deter_the_same is False and os.path.exists(deterPath):
            path_, name_, fun_ = folder, name, fun
            splitPath = path_[:-1].split("/")
            new_ = ".cache." + self.STATIC.file.md5(StringList=[url]) if tmp_name is None else ".cache." + tmp_name
            timeStr = time.strftime(f"%Y-%m-%d_{new_[7:12]}", time.localtime())
            timeStr2 = f"{new_[7:12]}_{str(time.time()).replace('.', '')}"
            if self.CORE.biu.sets["biu"]["download"]["autoDeterTheSame"]:
                if type_ == "file":
                    name_ = new_
                elif type_ == "folder":
                    path_ = "/".join(splitPath[:-1]) + "/" + new_ + "/"
                finalPath = path_ + name_ if type_ == "file" else path_
                maybePath = path_ + name + f"_{timeStr}{suf}" if type_ == "file" else folder[:-1] + f"_{timeStr}/"
                impossiblePath = path_ + name + f"_{timeStr2}{suf}" if type_ == "file" else folder[:-1] + f"_{timeStr2}/"
                atdeterPaths = {
                    "ori": deterPath,
                    "dst": finalPath,
                    "maybe": maybePath,
                    "impossible": impossiblePath,
                    "type": type_,
                    "id": id_
                }
                r["folder"], r["name"] = path_, name_ if type_ == "file" else f"{name_}{suf}"
                r["dlArgs"]["@deterPaths"] = atdeterPaths
                if fun_ is not None:
                    r["callback"] = [fun_, self.__callback_isTheSame]
                else:
                    r["callback"] = [self.__callback_isTheSame]
            else:
                if type_ == "file":
                    r["name"] = name + f"_{timeStr2}{suf}"
                elif type_ == "folder":
                    r["folder"] = folder[:-1] + f"_{timeStr2}/"
        return r

    def __deName(self, name, data):
        return (
            name.replace("{title}", self.__pureName(str(data["title"])))
                .replace("{work_id}", self.__pureName(str(data["id"])))
                .replace("{user_name}", self.__pureName(str(data["user"]["name"])))
                .replace("{user_id}", self.__pureName(str(data["user"]["id"])))
                .replace("{type}", self.__pureName(str(data["type"])))
        )

    def __pureName(self, name):
        return re.sub(r'[/\\:*?"<>|]', "_", name)

    def __getdlUgoiraPicsUrl(self, id_):
        try:
            r = self.CORE.biu.apiAssist.ugoira_metadata(id_)
            r = r["ugoira_metadata"]
        except:
            return False
        url = (
            r["zip_urls"]["medium"]
                .replace("600x600", "1920x1080")
                .replace("https://i.pximg.net", self.CORE.biu.pximgURL)
        )
        return url, r

    def __callback_isTheSame(self, this):
        if this._dlArgs["@deterPaths"]["id"] == "%end%":
            return True
        if this.status(self.CORE.dl.mod.CODE_GOOD_SUCCESS):
            if self.CORE.dl.modName == "aria2" and self.CORE.dl.mod.HOST not in ("127.0.0.1", "localhost"):
                return False
            while this._dlArgs["@deterPaths"]["id"] != "-1":
                isContinue = True
                status_arr = self.CORE.dl.status(this._dlArgs["@deterPaths"]["id"])
                for x in status_arr:
                    if x != "done":
                        isContinue = False
                if isContinue:
                    break
                time.sleep(0.5)
            rMD5Fun, rRemoveFun = lambda x: False, lambda x: False
            if this._dlArgs["@deterPaths"]["type"] == "file":
                rMD5Fun = self.STATIC.file.md5
                rRemoveFun = self.STATIC.file.rm
            elif this._dlArgs["@deterPaths"]["type"] == "folder":
                rMD5Fun = self.STATIC.file.folderMD5
                rRemoveFun = lambda path: self.STATIC.file.clearDIR(path, nothing=True)
            oriMD5 = rMD5Fun(this._dlArgs["@deterPaths"]["ori"])
            dstMD5 = rMD5Fun(this._dlArgs["@deterPaths"]["dst"])
            if oriMD5 == dstMD5:
                rRemoveFun(this._dlArgs["@deterPaths"]["dst"])
            else:
                if os.path.exists(this._dlArgs["@deterPaths"]["maybe"]):
                    maybeMD5 = rMD5Fun(this._dlArgs["@deterPaths"]["maybe"])
                    if dstMD5 == maybeMD5:
                        rRemoveFun(this._dlArgs["@deterPaths"]["dst"])
                    else:
                        self.STATIC.file.rename(this._dlArgs["@deterPaths"]["dst"],
                                                this._dlArgs["@deterPaths"]["impossible"])
                else:
                    self.STATIC.file.rename(this._dlArgs["@deterPaths"]["dst"], this._dlArgs["@deterPaths"]["maybe"])

    def __callback_merge(self, this):
        if this.status(self.CORE.dl.mod.CODE_GOOD_SUCCESS):
            if self.CORE.dl.modName == "aria2" and self.CORE.dl.mod.HOST not in ("127.0.0.1", "localhost"):
                return False
            j = this._dlArgs["@ugoira"]["r"]["frames"]
            pl = []
            dl = []
            for x in j:
                pl.append(os.path.join(this._dlSaveDir, "./data", x["file"]))
                dl.append(x["delay"])
            try:
                self.STATIC.file.unzip(os.path.join(this._dlSaveDir, "./data"),
                                       os.path.join(this._dlSaveDir, "ugoira.zip"))
                self.STATIC.file.rm(os.path.join(this._dlSaveDir, "ugoira.zip"))
                if self.CORE.biu.sets["biu"]["download"]["whatsUgoira"] == "gif":
                    self.STATIC.file.cov2gif(os.path.join(this._dlSaveDir, this._dlArgs["@ugoira"]["name"] + ".gif"),
                                             pl,
                                             dl)
                else:
                    self.STATIC.file.cov2webp(os.path.join(this._dlSaveDir, this._dlArgs["@ugoira"]["name"] + ".webp"),
                                              pl,
                                              dl)
            except:
                return False
            return True
