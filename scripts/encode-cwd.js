// Get the Claude project directory name for the current working directory
const cwd = process.cwd();
const sep = /[\\/]/g;
const normalized = cwd.replace(sep, '/');
let encoded = normalized;

// /c/Users/... → C--Users-...
const unixDrive = /^\/([a-zA-Z])\//;
const winDrive = /^([A-Z]):\//;

if (unixDrive.test(encoded)) {
  encoded = encoded.replace(unixDrive, function(_, d) { return d.toUpperCase() + '--'; });
} else if (winDrive.test(encoded)) {
  encoded = encoded.replace(winDrive, function(_, d) { return d + '--'; });
}

encoded = encoded.replace(/\//g, '-');
process.stdout.write(encoded);
