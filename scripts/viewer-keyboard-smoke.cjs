// Runs against the real built viewer, with the chrome smoke's isolated API.
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async function checkViewerKeyboard({ win, click, waitFor, mode, baseUrl }) {
    const evaluate = code => win.webContents.executeJavaScript(code);
    const dialog = '[data-slot="dialog-content"]';
    const current = `${dialog} button[aria-current="true"]`;
    const next = `${dialog} button[aria-label="Next page"]`;
    const prev = `${dialog} button[aria-label="Previous page"]`;
    const key = async keyCode => {
        win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await delay(40);
    };
    const page = number => waitFor(`document.querySelector(${JSON.stringify(current)})?.ariaLabel === 'Go to image ${number}'`);
    const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const unchanged = async () => {
        await delay(60);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(current)})?.ariaLabel`), 'Go to image 1');
    };

    await win.loadURL(`${baseUrl}/ranking?illust=2`);
    await page(1);
    // Electron only delivers native key input to a focused BrowserWindow.
    win.show();
    win.focus();
    await waitFor('document.hasFocus()');
    await waitFor(`document.querySelector(${JSON.stringify(dialog)})?.contains(document.activeElement)`);
    const scroll = await evaluate(`document.querySelector('[data-app-scroller]').scrollTop`);
    await key('Right'); // Initial close-button focus is sufficient.
    await page(2); // Page two's image is deliberately slow.
    await key('Right');
    await page(3); // Page three's image deliberately fails; navigation stays usable.
    await focus(next);
    await key('Return');
    await key('Right');
    await page(3);
    assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(next)})`), true);
    await key('Left');
    await page(2);
    await key('Left');
    await page(1);
    await focus(prev);
    await key('Space');
    await unchanged();
    assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(prev)})`), true);
    assert.equal(await evaluate(`document.querySelector('[data-app-scroller]').scrollTop`), scroll);

    // Tooltips must not claim the arrow; input/widgets and consumed keys must.
    await focus(next);
    await waitFor(`!!document.querySelector('[data-slot="tooltip-content"]')`);
    await key('Right');
    await page(2);
    await click(`${dialog} button[aria-label="Go to image 1"]`);
    await page(1);
    for (const flag of ['repeat', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
        await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ${flag}: true }))`);
        await unchanged();
    }
    assert.equal(await evaluate(`(() => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        event.preventDefault(); document.activeElement.dispatchEvent(event); return event.defaultPrevented;
    })()`), true);
    await unchanged();

    // Real bookmark popup: portal input and roving status controls retain keys.
    const bookmark = `${dialog} [data-slot="popover-trigger"]`;
    await waitFor(`!!document.querySelector(${JSON.stringify(`${bookmark}:not(:disabled)`)})`);
    await click(bookmark);
    await waitFor(`!!document.querySelector('[data-slot="popover-content"] input')`);
    await focus('[data-slot="popover-content"] input');
    await key('Right');
    await unchanged();
    await focus('[data-slot="popover-content"] button[aria-pressed]');
    const oldFocus = await evaluate('document.activeElement.textContent');
    await key('Right');
    assert.notEqual(await evaluate('document.activeElement.textContent'), oldFocus);
    await unchanged();
    // Even while focus is back at the trigger, an expanded popup wins.
    await focus(bookmark);
    await key('Right');
    await unchanged();
    await key('Escape');
    await waitFor(`!document.querySelector('[data-slot="popover-content"]')`);
    await key('Right');
    await page(2);
    await click(`${dialog} button[aria-label="Go to image 1"]`);

    // Zoom keeps its own scrolling and removes shortcut advertisements.
    await waitFor(`document.querySelector('${dialog} img[alt="Fixture artwork 2"]')?.naturalWidth > 0`);
    await click(`${dialog} .cursor-zoom-in`);
    await waitFor(`!!document.querySelector('${dialog} .cursor-grab')`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(next)}).hasAttribute('aria-keyshortcuts')`), false);
    await key('Right');
    await unchanged();
    assert.equal(await evaluate(`(() => {
        const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(e); return e.defaultPrevented;
    })()`), false);
    await click(`${dialog} .cursor-grab`);
    await waitFor(`!document.querySelector('${dialog} .cursor-grab')`);
    await key('Right');
    await page(2);

    await key('Escape');
    await waitFor(`!document.querySelector('${dialog}[data-open]')`);
    // A retained animation tree must not expose or execute a shortcut.
    assert.equal(await evaluate(`!!document.querySelector('${dialog} [aria-keyshortcuts]')`), false);
    await key('Right');
    await waitFor(`!document.querySelector('${dialog}')`);
    await click('img[alt="Fixture artwork 2"]');
    await page(1);
    await key('Tab');
    assert.equal(await evaluate(`document.querySelector('${dialog}').contains(document.activeElement)`), true);
    // Tab can open an arrow tooltip, whose Escape handling remains Base UI's.
    await click(`${dialog} button[aria-label="Close"]`);
    await waitFor(`!document.querySelector('${dialog}')`);
    // Card three seeds three pages, then its delayed detail returns only two.
    await evaluate(`document.querySelector('img[alt="Fixture artwork 3"]').scrollIntoView({ block: 'center' })`);
    await delay(100);
    await click('img[alt="Fixture artwork 3"]');
    await page(1);
    await key('Right');
    await page(2);
    await key('Right');
    await page(3);
    await waitFor(`document.querySelector('${dialog} [role="status"]')?.textContent === '2 / 2'`);
    await page(2);
    await key('Escape');
    await waitFor(`!document.querySelector('${dialog}')`);
    await evaluate(`document.querySelector('img[alt="Fixture artwork 1"]').scrollIntoView({ block: 'center' })`);
    await delay(100);
    await click('img[alt="Fixture artwork 1"]');
    await waitFor(`!!document.querySelector('${dialog}')`);
    await key('Right');
    assert.equal(await evaluate(`!!document.querySelector('${dialog} [aria-keyshortcuts]')`), false);
    await key('Escape');
    await waitFor(`!document.querySelector('${dialog}')`);
    console.log(`Viewer keyboard smoke passed: ${mode}${mode === 'native' ? ` (${process.platform})` : ' (no desktop bridge)'}`);
};
