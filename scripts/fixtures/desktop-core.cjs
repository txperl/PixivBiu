// Synthetic sidecar: no Pixiv traffic or real user data.
const fs = require('node:fs');
const http = require('node:http');
const mode = process.env.CORE_FIXTURE_MODE || 'normal';
fs.appendFileSync(process.env.CORE_FIXTURE_PIDS, `${process.pid}\n`);
if (mode !== 'legacy') process.stdout.write('pixivbiu-desktop/1\n');
if (mode === 'legacy' || mode === 'fail') {
    process.stderr.write('fixture startup error\n');
    process.exit(2);
}
if (mode === 'busy') process.exit(76);
if (mode === 'busy-once' && fs.readFileSync(process.env.CORE_FIXTURE_PIDS, 'utf8').trim().split('\n').length === 1) process.exit(76);
const server = http.createServer((req, res) => {
    res.end(JSON.stringify({ pid: process.pid }));
    if (req.url === '/restart') setTimeout(() => process.exit(75), 10);
    if (req.url === '/crash') setTimeout(() => process.exit(1), 10);
});
if (mode !== 'hang' && mode !== 'stubborn') server.listen(Number(process.env.PIXIVBIU_SERVER_PORT), '127.0.0.1', () => {
    if (mode !== 'foreign-health') process.stdout.write('pixivbiu-desktop/1 ready\n');
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
    if (data.includes('stop') && mode !== 'stubborn') process.exit(0);
});
process.stdin.on('end', () => { if (mode !== 'stubborn') process.exit(0); });
if (mode === 'stubborn') setInterval(() => {}, 1000);
if (mode === 'noisy') process.stderr.write('x'.repeat(2 * 1024 * 1024));
