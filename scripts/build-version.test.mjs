import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("./previous-core-tag.sh", import.meta.url));
const makefile = fileURLToPath(new URL("../Makefile", import.meta.url));

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pixivbiu-version-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const run = (cmd, args) => execFileSync(cmd, args, { cwd, env, encoding: "utf8" }).trim();
  const git = (...args) => run("git", args);
  git("init", "-q");
  git("config", "user.name", "Version test");
  git("config", "user.email", "version@example.invalid");
  const commit = () => git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture", "--allow-empty");
  commit();
  const tag = (name) => git("tag", name);
  const previous = (name) => run("bash", [helper, name]);
  return { cwd, env, run, git, commit, tag, previous };
}

test("same-commit promotion and reruns use lower channel-compatible bases", (t) => {
  const { tag, commit, previous, git } = repository(t);
  tag("v3.0.1");
  commit();
  tag("v3.1.0-alpha.2");
  commit();
  for (const name of ["v3.1.0-alpha.3", "v3.1.0-beta.1", "v3.1.0-rc.1", "v3.1.0", "v3.2.0", "desktop-v9.0.0", "v3.1.0-dev", "v3.1.0-alpha.03"]) tag(name);
  assert.equal(previous("v3.1.0"), "v3.0.1");
  assert.equal(previous("v3.1.0-alpha.3"), "v3.1.0-alpha.2");
  assert.equal(previous("v3.1.0-beta.1"), "v3.0.1");
  assert.equal(previous("v3.1.0-rc.1"), "v3.1.0-beta.1");
  // Annotated tags must behave exactly like lightweight tags.
  git("tag", "-a", "v3.3.0", "-m", "annotated release");
  assert.equal(previous("v3.3.0"), "v3.2.0");
});

test("numeric prerelease ordering and unrelated branches", (t) => {
  const { tag, commit, previous, git } = repository(t);
  tag("v3.0.0");
  const root = git("rev-parse", "HEAD");
  commit();
  tag("v3.1.0-alpha.2");
  tag("v3.1.0-alpha.10");
  const release = git("rev-parse", "HEAD");
  git("checkout", "-q", "--detach", root);
  git("-c", "commit.gpgsign=false", "commit", "-qm", "unrelated", "--allow-empty");
  tag("v3.1.0-alpha.9");
  git("checkout", "-q", "--detach", release);
  assert.equal(previous("v3.1.0-alpha.10"), "v3.1.0-alpha.2");
});

test("first release, malformed tags, and checkout mismatch", (t) => {
  const { tag, commit, previous, cwd, env } = repository(t);
  tag("v1.0.0");
  assert.equal(previous("v1.0.0"), "");
  for (const name of ["desktop-v1.0.0", "v01.0.0", "v1.0.0-dev", "v1.0.0-beta1", "v1.0.0-alpha.01", "v9.0.0"]) {
    assert.notEqual(spawnSync("bash", [helper, name], { cwd, env }).status, 0);
  }
  commit();
  assert.notEqual(spawnSync("bash", [helper, "v1.0.0"], { cwd, env }).status, 0);
});

test("local builds ignore all tags, preserve dirty state and explicit VERSION", (t) => {
  const { tag, run, git, cwd } = repository(t);
  tag("v3.1.0");
  tag("desktop-v1.0.0");
  git("tag", "-a", "v3.1.0-alpha.3", "-m", "annotated release");
  const build = (...args) => run("make", ["-s", "-n", "-f", makefile, "build", ...args]);
  assert.match(build(), /main.version=dev-[0-9a-f]+[" ]/);
  assert.match(build("VERSION=v3.1.0"), /main.version=v3\.1\.0[" ]/);
  writeFileSync(join(cwd, "tracked"), "before");
  git("add", "tracked");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "tracked file");
  writeFileSync(join(cwd, "tracked"), "after");
  assert.match(build(), /main.version=dev-[0-9a-f]+-dirty[" ]/);
});

// Exercise the wiring as well as the helper: the original bug was a missing
// override in the publishing step, despite correct changelog computation.
test("GoReleaser receives the triggering tag explicitly", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const publishingStep = workflow.split("      - uses: goreleaser/goreleaser-action@")[1].split("\n      - name:")[0];
  assert.match(publishingStep, /GORELEASER_CURRENT_TAG: \$\{\{ github\.ref_name \}\}/);
  assert.match(workflow, /bash scripts\/previous-core-tag\.sh "\$RELEASE_TAG"/);
});

test("source archives without Git metadata use dev-unknown", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pixivbiu-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = execFileSync("make", ["-s", "-n", "-f", makefile, "build"], { cwd, encoding: "utf8" });
  assert.match(output, /main.version=dev-unknown[" ]/);
});
