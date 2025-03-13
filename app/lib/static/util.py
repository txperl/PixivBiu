import os
import platform
import re
import socket
import time

from altfe.interface.root import interRoot


@interRoot.bind("util", "LIB_STATIC")
class StaticUtil(object):
    @staticmethod
    def get_system_proxy(sys_plc=None):
        """
        检测系统本地设置中的代理地址。
        @Windows: 通过注册表项获取
        @macOS: 通过 scutil 获取
        @Linux: 暂时未实现
        """
        if sys_plc is None:
            sys_plc = platform.system()
        # 命令选择
        if sys_plc == "Windows":
            cmd = r'reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | ' \
                  r'findstr "ProxyServer AutoConfigURL" '
        elif sys_plc == "Darwin":
            cmd = "scutil --proxy"
        else:
            return ""

        # 获取系统终端执行结果
        cmd_rst_obj = os.popen(cmd)
        cmd_rst = cmd_rst_obj.read()
        cmd_rst_obj.close()

        # 获取代理地址
        dic = {}
        if sys_plc == "Windows":
            # Windows
            maybe = ["AutoConfigURL", "ProxyServer"]
            for x in [re.split(r"\s+", x)[1:] for x in cmd_rst.split("\n")]:
                if len(x) != 3:
                    continue
                dic[x[0]] = x[2]
            for key in maybe:
                if key in dic:
                    return dic[key]
        elif sys_plc == "Darwin":
            # macOS
            maybe = ["HTTP", "HTTPS", "SOCKS", "ProxyAutoConfig"]
            for x in cmd_rst.replace(" ", "").split("\n"):
                if ":" not in x:
                    continue
                tmp = x.split(":")
                dic[tmp[0]] = ":".join(tmp[1:])
            for ptl in maybe:
                subkey = f"{ptl}Enable"
                if subkey in dic and dic[subkey] == "1":
                    if ptl == "ProxyAutoConfig":
                        proxy = dic["ProxyAutoConfigURLString"]
                    else:
                        proxy = "%s://%s:%s/" % (
                            ptl.lower() if ptl != "SOCKS" else "socks5", dic[ptl + "Proxy"], dic[ptl + "Port"]
                        )
                    return proxy
        return ""

    @staticmethod
    def is_local_connect(add, prt):
        # 检测本地是否可通
        try:
            port = int(port)
            if port >= 0 and port <= 65535:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(1)
                    return s.connect_ex((add, port)) == 0
        except:
            return False

    @staticmethod
    def is_prot_in_use(port):
        try:
            port = int(port)
            if port >= 0 and port <= 65535:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(1)
                    return s.connect_ex(("localhost", port)) == 0
        except:
            return False

    @staticmethod
    def format_time(date_string, style, to="%Y-%m-%d %H:%M:%S"):
        try:
            return time.strftime(to, time.strptime(str(date_string), style))
        except:
            return "Unknown"
