import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(new URL("./clean-build.mjs", import.meta.url), path.join(root, "scripts/clean-build.mjs"));
  const write = (name, value = "old build") => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  const clean = target => execFileSync(process.execPath, [path.join(root, "scripts/clean-build.mjs"), target], { stdio: "pipe" });
  return { root, write, clean };
}

test("build cleanup drops stale assets, preserves .gitkeep and is repeatable", t => {
  const { root, write, clean } = fixture(t);
  write("internal/web/dist/.gitkeep", "");
  write("internal/web/dist/assets/old.js");
  write("internal/web/dist/assets/old.css");
  write("internal/web/dist/index.html");
  write("internal/web/untouched.go");
  write("desktop/dist/deleted-module.js");
  clean("web");
  clean("web");
  clean("desktop");
  assert.deepEqual(fs.readdirSync(path.join(root, "internal/web/dist")), [".gitkeep"]);
  assert.deepEqual(fs.readdirSync(path.join(root, "desktop/dist")), []);
  assert.ok(fs.existsSync(path.join(root, "internal/web/untouched.go")));
  assert.throws(() => clean("../../outside"));
});

test("cleanup unlinks child links but refuses output and ancestor symlinks", { skip: process.platform === "win32" }, t => {
  const { root, write, clean } = fixture(t);
  write("outside/keep");
  write("internal/web/dist/.gitkeep", "");
  const output = path.join(root, "internal/web/dist");
  fs.symlinkSync(path.join(root, "outside"), path.join(output, "link"));
  clean("web");
  assert.ok(fs.existsSync(path.join(root, "outside/keep")));
  fs.rmSync(output, { recursive: true });
  fs.symlinkSync(path.join(root, "outside"), output);
  assert.throws(() => clean("web"));
  fs.unlinkSync(output);
  fs.rmSync(path.join(root, "internal/web"), { recursive: true });
  fs.symlinkSync(path.join(root, "outside"), path.join(root, "internal/web"));
  assert.throws(() => clean("web"));
  assert.ok(fs.existsSync(path.join(root, "outside/keep")));
});

test("parallel make waits for the SPA and stops on frontend failure", { skip: process.platform === "win32" }, t => {
  const { root, write } = fixture(t);
  fs.copyFileSync(new URL("../Makefile", import.meta.url), path.join(root, "Makefile"));
  fs.mkdirSync(path.join(root, "frontend"));
  write("tools/bun", '#!/bin/sh\nif [ "$1" = run ]; then sleep 0.1; touch ../frontend-ready; fi\n');
  write("tools/go", '#!/bin/sh\ntest -f frontend-ready || exit 9\ntouch backend-built\n');
  for (const name of ["bun", "go"]) fs.chmodSync(path.join(root, "tools", name), 0o755);
  const options = { cwd: root, env: { ...process.env, PATH: `${path.join(root, "tools")}${path.delimiter}${process.env.PATH}` }, encoding: "utf8" };
  execFileSync("make", ["-j4", "dist"], options);
  assert.ok(fs.existsSync(path.join(root, "backend-built")));
  fs.unlinkSync(path.join(root, "backend-built"));
  write("tools/bun", "#!/bin/sh\nexit 12\n");
  assert.notEqual(spawnSync("make", ["-j4", "dist"], options).status, 0);
  assert.ok(!fs.existsSync(path.join(root, "backend-built")));
});
