const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { packages, measurePackage, verifyPackage } = require("./package-audit.cjs");

exports.default = function reportPackages(result) {
    assert.ok(packages.size > 0, "No packages recorded by afterPack");
    const reportDir = path.join(result.outDir, "size-reports");
    fs.mkdirSync(reportDir, { recursive: true });
    let summary = "\n## Desktop package sizes\n\nLogical bytes; framework symlinks are not counted twice. Artifact sizes are compressed download bytes.\n\n";
    for (const [key, record] of packages) {
        const { layout, ...versions } = record;
        verifyPackage(layout);
        const platform = layout.platform === "win32" ? "windows" : layout.platform;
        const arches = layout.arch === "x64" && platform === "linux" ? ["x86_64", "amd64"] : [layout.arch];
        const artifacts = result.artifactPaths.filter(file => arches.some(arch => path.basename(file).includes(`-${platform}-${arch}`)))
            .sort().map(file => ({ name: path.basename(file), bytes: fs.statSync(file).size }));
        const report = { schemaVersion: 1, platform: layout.platform, arch: layout.arch, ...versions, ...measurePackage(layout), artifacts };
        fs.writeFileSync(path.join(reportDir, `${key}.json`), `${JSON.stringify(report, null, 2)}\n`);
        summary += `### ${key}\n\nDesktop ${report.version}; Electron ${report.electronVersion}; core release ${report.coreReleaseVersion ?? "local/unverified"}; pin ${report.corePin}.\n\n`;
        summary += "| Component | Bytes | MiB |\n| --- | ---: | ---: |\n";
        for (const field of ["expandedBytes", "localeBytes", "coreBytes", "asarBytes", "asarUnpackedBytes"]) {
            summary += `| ${field} | ${report[field]} | ${(report[field] / 2 ** 20).toFixed(2)} |\n`;
        }
        for (const artifact of artifacts) summary += `| ${artifact.name} | ${artifact.bytes} | ${(artifact.bytes / 2 ** 20).toFixed(2)} |\n`;
        summary += "\n";
    }
    fs.writeFileSync(path.join(reportDir, "summary.md"), summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary);
    packages.clear();
    // Keep diagnostics in CI artifacts; never add them to the update feed.
    return [];
};
