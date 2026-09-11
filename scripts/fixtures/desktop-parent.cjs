// Parent-death fixture: deliberately leave the lease open until killed.
const path = require('node:path');
const fs = require('node:fs');
const { CoreSupervisor } = require('../../desktop/dist/core-supervisor');
const { CoreDiagnostics } = require('../../desktop/dist/core-diagnostics');
const core = new CoreSupervisor({
    binary: process.execPath, args: [path.join(__dirname, 'desktop-core.cjs')], env: process.env,
    diagnostics: new CoreDiagnostics(process.env.CORE_FIXTURE_LOG), onState() {},
});
core.start().then(() => {
    if (core.state !== 'ready') process.exit(1);
    fs.writeFileSync(process.env.CORE_FIXTURE_READY, String(core.pid));
});
