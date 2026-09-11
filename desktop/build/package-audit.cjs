const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

// Use the packager's locked ASAR reader, including with nested npm installs.
const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
const asar = builderRequire("@electron/asar");
const { Arch } = builderRequire("builder-util");
const packages = new Map();
const languages = ["en", "zh-CN", "zh-TW", "ja"];
const normalize = value => value.toLowerCase().replaceAll("_", "-");
const matches = (wanted, actual) => actual === wanted || actual.startsWith(`${wanted}-`) || wanted.startsWith(`${actual}-`);

// Sum logical file lengths once per path, never following framework symlinks.
function filesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) return [];
        if (entry.isDirectory()) return filesUnder(file);
        return entry.isFile() ? [file] : [];
    });
}

function bytes(files) {
    return files.reduce((total, file) => total + fs.statSync(file).size, 0);
}

function sha256(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function regularFile(file) {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    assert.ok(stat?.isFile() && stat.size > 0, `Missing or empty regular file: ${file}`);
}

function verifyBinary(file, platform, arch) {
    regularFile(file);
    const data = fs.readFileSync(file);
    assert.ok(data.includes(Buffer.from("pixivbiu-desktop/1")),
        "Core lacks desktop lifecycle protocol v1: release the updated core and bump desktop/.core-version before packaging");
    if (platform === "darwin") {
        assert.equal(data.readUInt32LE(0), 0xfeedfacf, "Core must be a thin 64-bit Mach-O");
        assert.equal(data.readUInt32LE(4), arch === "arm64" ? 0x0100000c : 0x01000007, "Core CPU mismatch");
    } else if (platform === "win32") {
        assert.equal(data.toString("ascii", 0, 2), "MZ", "Core must be a Windows executable");
        const pe = data.readUInt32LE(0x3c);
        assert.equal(data.toString("ascii", pe, pe + 4), "PE\0\0", "Missing PE header");
        assert.equal(data.readUInt16LE(pe + 4), arch === "arm64" ? 0xaa64 : 0x8664, "Core CPU mismatch");
    } else {
        assert.equal(data.toString("hex", 0, 6), "7f454c460201", "Core must be a little-endian 64-bit ELF");
        assert.equal(data.readUInt16LE(18), arch === "arm64" ? 183 : 62, "Core CPU mismatch");
    }
}

function localeEntries(layout) {
    return layout.localeDirectories.flatMap(directory => fs.readdirSync(directory)
        .filter(name => name.endsWith(layout.localeExtension))
        .map(name => ({ name: name.slice(0, -layout.localeExtension.length), file: path.join(directory, name) })));
}

function verifyLocales(layout) {
    const entries = localeEntries(layout);
    for (const language of languages) {
        // Require a base resource, not just one of Chromium's gender variants.
        assert.ok(entries.some(entry => {
            const actual = normalize(entry.name);
            return !/-(feminine|masculine|neuter)$/.test(actual) && matches(normalize(language), actual) &&
                (entry.file.endsWith(".pak") ? fs.statSync(entry.file).size > 0 : bytes(filesUnder(entry.file)) > 0);
        }), `Missing Electron language: ${language}`);
    }
    for (const entry of entries) {
        assert.ok(languages.some(language => matches(normalize(language), normalize(entry.name))),
            `Unexpected Electron language: ${entry.name}`);
    }
}

function verifyAsar(archive) {
    regularFile(archive);
    asar.uncache(archive);
    const entries = new Map();
    function walk(tree, prefix = "") {
        for (const [name, entry] of Object.entries(tree.files ?? {})) {
            const file = prefix + name;
            if (entry.files) walk(entry, `${file}/`);
            else entries.set(file, entry);
        }
    }
    walk(asar.getRawHeader(archive).header);
    for (const [file, entry] of entries) {
        assert.ok(file === "package.json" || /^dist\/.+\.js$/.test(file) || file.startsWith("node_modules/"),
            `Unexpected ASAR payload: ${file}`);
        assert.ok(!/\.(map|ts)$/.test(file) && !/(^|\/)pixivbiu(\.exe)?$/.test(file), `Forbidden ASAR payload: ${file}`);
        assert.ok(!entry.link, `Unexpected ASAR link: ${file}`);
        if (entry.unpacked) regularFile(path.join(`${archive}.unpacked`, file));
    }
    const json = file => JSON.parse(asar.extractFile(archive, file).toString());
    const hasFile = file => entries.has(file) && entries.get(file).size > 0;
    const entryExists = main => [main, `${main}.js`, `${main}.json`, `${main}.node`, `${main}/index.js`].some(hasFile);
    const manifest = json("package.json");
    assert.equal(manifest.main, "dist/main.js", "Unexpected application entry");
    for (const entry of [manifest.main, "dist/preload.js"]) assert.ok(hasFile(entry), `Missing entry: ${entry}`);
    assert.ok(manifest.dependencies?.["electron-updater"], "Missing updater dependency");

    // Walk declared production dependencies through Node's nested/hoisted layout.
    // Do not execute packaged code in the build process.
    const visited = new Set();
    function visit(packageDir, pkg) {
        if (visited.has(packageDir)) return;
        visited.add(packageDir);
        assert.ok(entryExists(path.posix.join(packageDir, pkg.main || "index.js")), `Missing package entry: ${packageDir || "."}`);
        for (const dependency of Object.keys(pkg.dependencies ?? {})) {
            if (Object.hasOwn(pkg.optionalDependencies ?? {}, dependency)) continue;
            let current = packageDir;
            let found;
            while (true) {
                const candidate = path.posix.join(current, "node_modules", dependency, "package.json");
                if (hasFile(candidate)) { found = candidate; break; }
                if (!current) break;
                const parent = path.posix.dirname(current);
                current = parent === "." ? "" : parent;
            }
            assert.ok(found, `Missing production dependency: ${dependency} (from ${packageDir || "."})`);
            visit(path.posix.dirname(found), json(found));
        }
    }
    visit("", manifest);
    return manifest;
}

function verifyPackage(layout) {
    verifyLocales(layout);
    const manifest = verifyAsar(path.join(layout.resources, "app.asar"));
    const coreName = layout.platform === "win32" ? "pixivbiu.exe" : "pixivbiu";
    const cores = filesUnder(layout.resources).filter(file => /^pixivbiu(?:\.exe)?$/.test(path.basename(file)));
    assert.deepEqual(cores, [path.join(layout.resources, coreName)], "Expected exactly one core at the resources root");
    verifyBinary(cores[0], layout.platform, layout.arch);
    regularFile(path.join(layout.resources, "app-update.yml"));
    regularFile(path.join(layout.resources, "icon.png"));
    regularFile(path.join(layout.resources, "icon.ico"));
    const licenses = layout.platform === "darwin" ? layout.resources : layout.appRoot;
    regularFile(path.join(licenses, "LICENSE.electron.txt"));
    regularFile(path.join(licenses, "LICENSES.chromium.html"));
    return manifest;
}

function measurePackage(layout) {
    const archive = path.join(layout.resources, "app.asar");
    const core = path.join(layout.resources, layout.platform === "win32" ? "pixivbiu.exe" : "pixivbiu");
    const locales = localeEntries(layout).flatMap(entry => entry.file.endsWith(".pak") ? [entry.file] : filesUnder(entry.file));
    const unpacked = `${archive}.unpacked`;
    return {
        expandedBytes: bytes(filesUnder(layout.appRoot)),
        localeBytes: bytes(locales),
        asarBytes: fs.statSync(archive).size,
        asarUnpackedBytes: fs.existsSync(unpacked) ? bytes(filesUnder(unpacked)) : 0,
        coreBytes: fs.statSync(core).size,
        coreSha256: sha256(core),
    };
}

function recordPackage(context) {
    const { packager, appOutDir, electronPlatformName: platform } = context;
    const arch = Arch[context.arch];
    assert.ok(["darwin", "win32", "linux"].includes(platform) && ["x64", "arm64"].includes(arch), "Unsupported package platform/arch");
    const resources = packager.getResourcesDir(appOutDir);
    const layout = {
        platform, arch, resources,
        appRoot: platform === "darwin" ? path.dirname(path.dirname(resources)) : appOutDir,
        localeDirectories: platform === "darwin" ? [resources, packager.getMacOsElectronFrameworkResourcesDir(appOutDir)] : [path.join(appOutDir, "locales")],
        localeExtension: platform === "darwin" ? ".lproj" : ".pak",
    };
    const manifest = verifyPackage(layout);
    const coreName = platform === "win32" ? "pixivbiu.exe" : "pixivbiu";
    const stagedCore = path.join(packager.projectDir, "resources", arch, coreName);
    const stagedCoreSha256 = sha256(stagedCore);
    assert.equal(sha256(path.join(resources, coreName)), stagedCoreSha256, "Packaged core differs from staged core before signing");
    packages.set(`${platform}-${arch}`, {
        layout, version: manifest.version, electronVersion: packager.info.framework.version,
        coreReleaseVersion: process.env.CORE_VERSION || null,
        // A pin alone does not prove that a local working-tree core is that release.
        corePin: fs.readFileSync(path.join(packager.projectDir, ".core-version"), "utf8").trim(),
        stagedCoreSha256,
    });
}

module.exports = { languages, filesUnder, sha256, verifyBinary, verifyLocales, verifyAsar, verifyPackage, measurePackage, recordPackage, packages };
