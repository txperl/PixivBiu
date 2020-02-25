from flask import Flask, render_template, jsonify
from flask_cors import CORS
from app.platform import CMDProcessor
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

    if sets["sys"]["isDebug"]:
        CORS(app, resources=r"/*")  # 允许跨域请求
    else:
        logging.getLogger("werkzeug").setLevel(logging.ERROR)  # 调整日志等级

    app.run(
        host=sets["sys"]["host"].split(":")[0],
        port=sets["sys"]["host"].split(":")[1],
        debug=sets["sys"]["isDebug"],
    )

