const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UNUSED_USAGE_DESCRIPTIONS = [
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
];

exports.default = function removeUnusedMacUsageDescriptions(context) {
    if (context.electronPlatformName !== "darwin") return;

    const plist = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Info.plist",
    );
    if (!fs.existsSync(plist)) throw new Error(`packaged Info.plist not found: ${plist}`);

    for (const key of UNUSED_USAGE_DESCRIPTIONS) {
        try {
            execFileSync("/usr/bin/plutil", ["-remove", key, plist], { stdio: "ignore" });
        } catch {
            // Electron may stop shipping one of these defaults in a future
            // release. An already-absent key is the desired state.
        }
    }
    execFileSync("/usr/bin/plutil", ["-lint", plist], { stdio: "inherit" });
};
