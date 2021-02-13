import os
import re
import telnetlib


class util(object):
    @staticmethod
    def getSystemProxy(sysPlc):
        """
        检测系统本地设置中的代理地址，并验证是否可用。
        @Windows: 通过注册表项获取
        @macOS: 通过 scutil 获取
        @Linux: 暂时未实现
        """
        proxies = []
        cmd = ""

        if sysPlc == "Windows":
            cmd = r'reg query "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | ' \
                  r'findstr "ProxyServer AutoConfigURL" '
        elif sysPlc == "Darwin":
            cmd = "scutil --proxy"
        else:
            return ""

        # 获取系统 console 执行结果
        cmdRstObj = os.popen(cmd)
        cmdRst = cmdRstObj.read()
        cmdRstObj.close()
        cmdRstArr = cmdRst.split("\n")[:-1]
        proxies = [re.split(r"\s+", x)[1:] for x in cmdRstArr]

        # 筛选出可用代理地址
        for i in range(len(proxies) - 1, -1, -1):
            x = proxies[i]
            if len(x) < 3:
                continue
            add = prt = None

            if sysPlc == "Windows":
                tmp = re.match(r"https?:\/\/(.*?):(\d+)", x[2], re.IGNORECASE)
                if tmp is None:
                    continue
                add = tmp.group(1)
                prt = int(tmp.group(2))
            elif sysPlc == "Darwin":
                tmp = re.match(r"https?proxy", x[0], re.IGNORECASE)
                if tmp is None:
                    continue
                add = proxies[i][2]
                prt = int(proxies[i - 1][2])

            # 检测本地是否可通
            if add and prt:
                try:
                    telnetlib.Telnet(add, port=prt, timeout=1)
                    url = f"http://{add}:{prt}/"
                    return url
                except:
                    pass

        return ""
