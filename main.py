import logging
import os
import sys
import traceback
import webbrowser

from flask import Flask, jsonify, render_template

from altfe import bridge, handle
from altfe.interface.root import classRoot

rootPath = os.path.split(os.path.realpath(sys.argv[0]))[0] + "/"
rootPathFrozen = sys._MEIPASS + "/" if getattr(sys, "frozen", False) else rootPath

app = Flask(
    __name__,
    template_folder=rootPath + "usr/templates",
    static_folder=rootPath + "usr/static",
)


# 路由
@app.route("/")
def home():
    return render_template("%s/index.html" % (SETS["sys"]["theme"]))


@app.route("/<path:path>", methods=["GET", "POST"])
def api(path):
    return jsonify(handle.handleRoute.do(path))


if __name__ == '__main__':
    # Altfe 框架初始化
    classRoot.setENV("rootPath", rootPath)
    classRoot.setENV("rootPathFrozen", rootPathFrozen)
    bridge.bridgeInit().run(hint=True)

    # 加载配置项
    SETS = classRoot.osGet("LIB_INS", "conf").dict("biu_default")

    # 调整日志等级
    if not SETS["sys"]["debug"]:
        cli = sys.modules['flask.cli']
        cli.show_server_banner = lambda *x: None
        logging.getLogger("werkzeug").setLevel(logging.ERROR)

    # 启动
    try:
        if SETS["sys"]["autoOpen"]:
            webbrowser.open("http://" + SETS["sys"]["host"])
        app.run(
            host=SETS["sys"]["host"].split(":")[0],
            port=SETS["sys"]["host"].split(":")[1],
            debug=SETS["sys"]["debug"],
            threaded=True,
            use_reloader=False,
        )
    except UnicodeDecodeError:
        print("您的计算机名可能存在特殊字符，程序无法正常运行。")
        print("若是 Windows 系统，可以尝试进入「计算机-属性-高级系统设置-计算机名-更改」，修改计算机名，只可含有 ASCII 码支持的字符。")
        input("按任意键退出...")
    except Exception:
        print(traceback.format_exc())
