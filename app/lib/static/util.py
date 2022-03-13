import os
import re
import socket
import telnetlib
import time

from altfe.interface.root import interRoot


@interRoot.bind("util", "LIB_STATIC")
class util(object):
    @staticmethod
    def getSystemProxy(sysPlc):
        """
        检测系统本地设置中的代理地址。
        @Windows: 通过注册表项获取
        @macOS: 通过 scutil 获取
        @Linux: 暂时未实现
        """

        # 命令选择
        if sysPlc == "Windows":
            cmd = r'reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | ' \
                  r'findstr "ProxyServer AutoConfigURL" '
        elif sysPlc == "Darwin":
            cmd = "scutil --proxy"
        else:
            return ""

        # 获取系统终端执行结果
        cmdRstObj = os.popen(cmd)
        cmdRst = cmdRstObj.read()
        cmdRstObj.close()

        # 获取代理地址
        dic = {}
        if sysPlc == "Windows":
            # Windows
            for x in [re.split(r"\s+", x)[1:] for x in cmdRst.split("\n")]:
                if len(x) != 3:
                    continue
                dic[x[0]] = x[2]
            MAY = ["AutoConfigURL", "ProxyServer"]
            for key in MAY:
                if key in dic:
                    return dic[key]
        elif sysPlc == "Darwin":
            # macOS
            for x in cmdRst.replace(" ", "").split("\n"):
                if ":" not in x:
                    continue
                tmp = x.split(":")
                dic[tmp[0]] = ":".join(tmp[1:])
            SUP = ["HTTP", "HTTPS", "SOCKS", "ProxyAutoConfig"]
            for ptl in SUP:
                subKey = f"{ptl}Enable"
                if subKey in dic and dic[subKey] == "1":
                    if ptl == "ProxyAutoConfig":
                        proxy = dic["ProxyAutoConfigURLString"]
                    else:
                        proxy = "%s://%s:%s/" % (
                            ptl.lower() if ptl != "SOCKS" else "socks5", dic[ptl + "Proxy"], dic[ptl + "Port"]
                        )
                    return proxy

        return ""

    @staticmethod
    def isLocalCon(add, prt):
        # 检测本地是否可通
        try:
            telnetlib.Telnet(add, port=prt, timeout=1)
            return True
        except:
            return False

    @staticmethod
    def isPortInUse(port):
        port = int(port)
        if port >= 0 and port <= 65535:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(("localhost", port)) == 0
        return False

    @staticmethod
    def format_time(date_string, style, to="%Y-%m-%d %H:%M:%S"):
        try:
            return time.strftime(to, time.strptime(str(date_string), style))
        except:
            return "Unknown"
