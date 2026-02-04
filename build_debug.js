const { spawn } = require('child_process');
const child = spawn('npx.cmd', ['vite', 'build'], { shell: true });

child.stdout.on('data', (data) => {
    process.stdout.write(data);
});

child.stderr.on('data', (data) => {
    process.stdout.write(`[STDERR] ${data}`);
});

child.on('close', (code) => {
    console.log(`[EXIT] Child process exited with code ${code}`);
});

child.on('error', (err) => {
    console.error('[ERROR] Failed to start subprocess:', err);
});
