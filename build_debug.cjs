const { spawn } = require('child_process');
const process = require('process');

console.log('Starting build debug...');
const child = spawn('npx.cmd', ['vite', 'build'], { shell: true });

child.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
});

child.stderr.on('data', (data) => {
    process.stdout.write(`[STDERR] ${data.toString()}`);
});

child.on('close', (code) => {
    console.log(`[EXIT] Child process exited with code ${code}`);
});

child.on('error', (err) => {
    console.error('[ERROR] Failed to start subprocess:', err);
});
