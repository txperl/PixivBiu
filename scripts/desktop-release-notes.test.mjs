import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
    CHANGELOG_END,
    CHANGELOG_START,
    extractChangelog,
    parseFeedRepository,
    parseVersion,
    stitchReleaseNotes,
} = require("../desktop/dist/release-notes.js");

const body = (notes) => `Intro\n\n## What's changed\n\n${CHANGELOG_START}\n\n${notes}\n\n${CHANGELOG_END}\n\n## Downloads\n\n| table |`;
const release = (tag, notes, extra = {}) => ({ tag_name: tag, draft: false, body: notes === null ? "legacy body" : body(notes), ...extra });

const lexCompare = (a, b) => a.map((x, i) => x - b[i]).find((d) => d !== 0) ?? 0;

test("desktop versions order alpha < beta < stable", () => {
    const order = ["1.0.0-alpha.1", "1.0.0-alpha.2", "1.0.0-beta.1", "1.0.0", "1.0.1", "1.1.0-alpha.1"];
    for (let i = 1; i < order.length; i++) {
        const cmp = lexCompare(parseVersion(order[i - 1]).precedence, parseVersion(order[i]).precedence);
        assert.ok(cmp < 0, `${order[i - 1]} < ${order[i]}`);
    }
    assert.equal(parseVersion("v1.2.3").prerelease, false);
    assert.equal(parseVersion("1.2.3-beta.2").prerelease, true);
    assert.equal(parseVersion("1.2.3-rc.1"), undefined);
});

test("changelog sections are extracted only between markers", () => {
    assert.equal(extractChangelog(body("### Features\n\n- A")), "### Features\n\n- A");
    assert.equal(extractChangelog("no markers here"), undefined);
    assert.equal(extractChangelog(`${CHANGELOG_START}\n\n${CHANGELOG_END}`), undefined);
    assert.equal(extractChangelog(`${CHANGELOG_START} unterminated`), undefined);
    assert.equal(extractChangelog(null), undefined);
});

test("skipped versions stitch newest first under version headings", () => {
    const releases = [
        release("v1.0.1", "- one"),
        release("v1.0.3", "- three"),
        release("v1.0.4", "- four (newer than offered)"),
        release("v1.0.2", "- two"),
        release("v1.0.0", "- zero (installed)"),
        release("v1.0.5", "- draft", { draft: true }),
    ];
    assert.equal(
        stitchReleaseNotes(releases, "1.0.0", "1.0.3"),
        "## v1.0.3\n\n- three\n\n## v1.0.2\n\n- two\n\n## v1.0.1\n\n- one",
    );
});

test("stable users skip intermediate prereleases; prerelease users see them", () => {
    const releases = [
        release("v1.1.0", "- stable"),
        release("v1.1.0-beta.1", "- beta"),
        release("v1.0.1", "- patch"),
    ];
    assert.equal(stitchReleaseNotes(releases, "1.0.0", "1.1.0"), "## v1.1.0\n\n- stable\n\n## v1.0.1\n\n- patch");
    assert.equal(
        stitchReleaseNotes(releases, "1.1.0-alpha.1", "1.1.0"),
        "## v1.1.0\n\n- stable\n\n## v1.1.0-beta.1\n\n- beta",
    );
});

test("nothing to stitch keeps the caller's single-release notes", () => {
    const releases = [release("v1.0.2", "- two"), release("v1.0.1", null)];
    assert.equal(stitchReleaseNotes(releases, "1.0.1", "1.0.2"), undefined, "single hop");
    assert.equal(stitchReleaseNotes(releases, "1.0.0", "1.0.2"), undefined, "legacy bodies have no markers");
    assert.equal(stitchReleaseNotes(releases, "1.0.2", "1.0.2"), undefined, "not newer");
    assert.equal(stitchReleaseNotes(releases, "dev", "1.0.2"), undefined, "unparseable current");
});

test("feed repository comes from the packaged app-update.yml", () => {
    const yml = "owner: txperl\nrepo: PixivBiu-Desktop\nprovider: github\nreleaseType: draft\nupdaterCacheDirName: pixivbiu-updater\n";
    assert.deepEqual(parseFeedRepository(yml), { owner: "txperl", repo: "PixivBiu-Desktop" });
    assert.equal(parseFeedRepository(yml.replace("provider: github", "provider: generic")), undefined);
    assert.equal(parseFeedRepository("provider: github\nowner: x\n"), undefined);
});
