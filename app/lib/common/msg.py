# coding=utf-8
import os
import platform

BIUMSG_METHODS = {
    "default": 0, "highlight": 1, "underline": 4, "flash": 5, "anti": 7, "disable": 8
}

BIUMSG_COLORS = {
    "black": (30, 40),
    "red": (31, 41),
    "green": (32, 42),
    "yellow": (33, 43),
    "blue": (34, 44),
    "purple-red": (35, 45),
    "cyan-blue": (36, 46),
    "white": (37, 47),
    "default": (38, 38)
}

BIUMSG_isColor = True
if os.name == "nt":
    os.system("color")
    if "10" not in platform.platform():
        BIUMSG_isColor = False


class biuMsg(object):
    def __init__(self, app):
        self.appName = app

    def msg(self, text, header=True, out=True):
        r = self.mformat(text, "default", header=header)
        if not out:
            return r
        print(r)

    def sign(self, text, header=True, out=True):
        r = self.mformat(text, "white", "black", "highlight", header=header)
        if not out:
            return r
        print(r)

    def error(self, text, header=True, out=True):
        r = self.mformat(text, "red", header=header)
        if not out:
            return r
        print("Error: \n" + r + "\nEnd;")

    def green(self, text, header=True, out=True):
        r = self.mformat(text, "green", header=header)
        if not out:
            return r
        print(r)

    def red(self, text, header=True, out=True):
        r = self.mformat(text, "red", header=header)
        if not out:
            return r
        print(r)

    def arr(self, *text):
        for x in text:
            if type(x) == str:
                print(self.mformat(x, "default"))
            elif type(x) == tuple:
                print(self.mformat("%s: %s" % x, "default"))

    def mformat(self, text, front, back=None, method="default", header=False):
        if header is False:
            finalText = text
        else:
            finalText = "[%s] %s" % (self.appName if header is True else header, text)
        if BIUMSG_isColor is False:
            return finalText
        if back is None:
            r = f"\033[{BIUMSG_COLORS[front][0]}m{finalText}\033[0m"
        else:
            r = f"\033[{BIUMSG_METHODS[method]};{BIUMSG_COLORS[front][0]};{BIUMSG_COLORS[back][1]}m{finalText}\033[0m"
        return r
