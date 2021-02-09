# coding=utf-8
import traceback

from flask import Flask, render_template, jsonify
from app.platform import CMDProcessor
import webbrowser
import logging
import sys

ENVIRON = CMDProcessor.getEnv()  # 加载环境变量
app = Flask(
    __name__,
    template_folder=ENVIRON["ROOTPATH"] + "usr/templates",
    static_folder=ENVIRON["ROOTPATH"] + "usr/static",
)


# 路由
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def pixivbiu(path):
    if path == "":
        return render_template(
            "%s/index.html" % (sets["sys"]["theme"]), ENVIRON=ENVIRON
        )
    return jsonify(CMDProcessor().process(path))


if __name__ == "__main__":
    # 获取配置
    sets = CMDProcessor.loadSet("{ROOTPATH}config.yml")
    # 调整日志等级
    if not sets["sys"]["isDebug"]:
        cli = sys.modules['flask.cli']
        cli.show_server_banner = lambda *x: None
        logging.getLogger("werkzeug").setLevel(logging.ERROR)
    # 启动
    try:
        if sets["sys"]["autoOpen"]:
            webbrowser.open("http://" + sets["sys"]["host"])
        app.run(
            host=sets["sys"]["host"].split(":")[0],
            port=sets["sys"]["host"].split(":")[1],
            debug=sets["sys"]["isDebug"],
            threaded=True,
            use_reloader=False,
        )
    except UnicodeDecodeError:
        print("您的计算机名可能存在特殊字符，程序无法正常运行。")
        print("若是 Windows 系统，可以尝试进入「计算机-属性-高级系统设置-计算机名-更改」，修改计算机名，只可含有 ASCII 码支持的字符。")
        input("按任意键退出...")
    except:
        print(traceback.format_exc())
