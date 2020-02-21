from flask import Flask, render_template, jsonify
from flask_cors import CORS
from app.platform import CMDProcessor
import logging
import yaml
import sys
import os

ROOTPAHT = os.path.split(os.path.realpath(sys.argv[0]))[0] + "/"

app = Flask(
    __name__,
    template_folder=ROOTPAHT + "usr/templates",
    static_folder=ROOTPAHT + "usr/static",
)

# 调整 flask 日志等级
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)
with open(ROOTPAHT + "config.yml", "r", encoding="UTF-8") as c:
    sets = yaml.safe_load(c)

if sets["sys"]["isDebug"]:
    CORS(app, resources=r"/*")  # 允许跨域请求


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def pixivbiu(path):
    if path == "":
        return render_template(
            "%s/index.html" % (sets["sys"]["theme"]), ROOTPATH=ROOTPAHT
        )

    processor = CMDProcessor()

    r = processor.process(path)

    return jsonify(r)


if __name__ == "__main__":
    app.run(
        host=sets["sys"]["host"].split(":")[0],
        port=sets["sys"]["host"].split(":")[1],
        debug=sets["sys"]["isDebug"],
    )
