# coding=utf-8
from flask import Flask, render_template, jsonify
from app.platform import CMDProcessor
import webbrowser
import logging
import yaml
import sys
import os


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
    sets = CMDProcessor.loadSet("{ROOTPATH}config.yml")  # 获取配置
    if not sets["sys"]["isDebug"]:
        logging.getLogger("werkzeug").setLevel(logging.ERROR)  # 调整日志等级

    try:
        if sets["sys"]["autoOpen"]:
            webbrowser.open("http://" + sets["sys"]["host"])
        app.run(
            host=sets["sys"]["host"].split(":")[0],
            port=sets["sys"]["host"].split(":")[1],
            debug=sets["sys"]["isDebug"],
            threaded=True,
        )
    except UnicodeDecodeError:
        print("您的计算机用户名可能存在特殊字符，程序无法正常运行。")
        input("按任意键退出...")
