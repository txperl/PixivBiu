import os
import shutil
import sys
import warnings
from pathlib import Path

import cloudscraper
import pixivpy3

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)

ROOT_PATH = os.path.split(os.path.realpath(sys.argv[0]))[0]
CODE_PATH = os.path.join(ROOT_PATH, "code")
PUBLIC_PATH = os.path.join(ROOT_PATH, "public")
TMP_PATH = os.path.join(ROOT_PATH, "tmp")
DIST_PATH = os.path.join(ROOT_PATH, "dist")


# 复制文件夹
def copyDIR(src, dst, cover=True, ignore=[]):
    if not os.path.exists(dst):
        os.makedirs(dst)
    for item in os.listdir(src):
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if item in ignore:
            print("[Ignored] " + s)
            continue
        if os.path.isdir(s):
            copyDIR(s, d, cover, ignore)
        else:
            if cover is True or (
                not os.path.exists(d) or os.stat(s).st_mtime - os.stat(d).st_mtime > 1
            ):
                shutil.copy2(s, d)
                print("[Copied] %s -> %s" % (s, d))


# 清空文件夹
def deleteDIR(folder):
    if not os.path.exists(folder):
        return
    for filename in os.listdir(folder):
        file_path = os.path.join(folder, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        except Exception as e:
            print("Failed to delete %s. Reason: %s" % (file_path, e))


# 替换文件
def replaceFile(ori, dst):
    if not os.path.exists(ori) or not os.path.exists(dst):
        return False
    print("[Replaced] %s -> %s" % (ori, dst))
    with open(ori, "r", encoding="utf-8") as f:
        data = f.read()
    with open(dst, "w", encoding="utf-8") as f:
        f.write(data)


# 列出路径下所有文件
def files(path, frmt="*", OTH=["", "pyc", "DS_Store"]):
    tmp = []
    r = []
    for x in list(Path(path).glob("*")):
        if os.path.isdir(x):
            tmp += files(x, frmt)
        else:
            if frmt == "*" or len(str(x).split(frmt)) > 1:
                tmp.append([str(x), x.stem, x.suffix[1:]])
    for x in tmp:
        if x[2] in OTH:
            continue
        r.append(x)
    return r


if __name__ == "__main__":
    silent = False
    if len(sys.argv) == 2:
        if sys.argv[1] == "auto":
            silent = True
    args = {
        "-F": "",
        "--distpath": DIST_PATH,
        "--workpath": os.path.join(TMP_PATH, "build"),
        "--specpath": CODE_PATH,
    }
    oargs = []
    BET = ";" if os.name == "nt" else ":"
    SPT = "\\" if os.name == "nt" else "/"

    # CloudScraper
    if silent or input("是否替换 CloudScraper/user_agent/__init__.py 文件？") == "y":
        cdsr = os.path.dirname(cloudscraper.__file__)
        replaceFile(
            f"{ROOT_PATH}{SPT}r_cloudscraper.py",
            f"{cdsr}{SPT}user_agent{SPT}__init__.py",
        )

    # pixivpy
    if silent or input("是否替换 pixivpy3/bapi.py 文件？") == "y":
        pxpy = os.path.dirname(pixivpy3.__file__)
        replaceFile(f"{ROOT_PATH}{SPT}r_pixivpy.py", f"{pxpy}{SPT}bapi.py")

    # 导入动态加载的文件、模块
    allImportLines = []
    for x in files(os.path.join(CODE_PATH, "app")):
        print(x)
        ori = x[0].replace(CODE_PATH, "")
        dest = "/".join(ori.split(SPT)[:-1])
        oargs.append(f"--add-data {ori[1:]}{BET}{dest[1:]}")
        # 分析动态加载文件中所使用的包
        if x[2] == "py":
            with open(x[0], "r", encoding="UTF-8") as f:
                lines = f.readlines()
                for line in lines:
                    if (
                        line[:4] == "from" or line[:6] == "import"
                    ) and line not in allImportLines:
                        allImportLines.append(line)
    with open(os.path.join(CODE_PATH, "main.py"), "r+", encoding="UTF-8") as f:
        content = f.read()
        f.seek(0, 0)
        f.write("\n".join(allImportLines) + content)

    # 图标加载
    if os.name == "nt":
        args["--icon"] = os.path.join(ROOT_PATH, "r_pixiv.ico")

    # 参数拼接
    forarg = ""
    for x in args:
        forarg += " " + x + (" " if args[x] != "" else "") + args[x]
    for x in oargs:
        forarg += " " + x

    # 清空 DIST 文件夹
    if silent or input("是否清空 DIST 生成文件夹？") == "y":
        deleteDIR(DIST_PATH)

    # 复制 PUBLIC 文件
    copyDIR(
        PUBLIC_PATH,
        DIST_PATH,
        True,
        ["cache", "__pycache__", ".token", ".DS_Store"],
    )

    # PyInstaller 打包
    os.system("pyinstaller%s %s" % (forarg, os.path.join(CODE_PATH, "main.py")))

    # 清空 TMP 文件夹
    if silent or input("是否清空 TMP 缓存文件夹？") == "y":
        deleteDIR(TMP_PATH)
