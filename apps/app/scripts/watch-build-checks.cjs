const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

// Independence is structural: the native client must have no phone transport.
function verifySources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) verifySources(path);
    else if (entry.name.endsWith('.swift')) {
      const source = readFileSync(path, 'utf8');
      if (/import\s+WatchConnectivity|WCSession|URLSessionWebSocketTask|webSocketTask\s*\(/.test(source)) {
        throw new Error(`Independent Watch transport violation: ${path}`);
      }
    }
  }
}
verifySources(join(__dirname, '../targets/litechat-watch'));
console.log('Watch source independence check passed.');
if (process.env.EAS_BUILD_PLATFORM === 'ios') {
  // This hook runs after prebuild and CocoaPods, so the remote build number EAS applied to the
  // companion is already generated and can be mirrored onto the Watch app before compiling.
  execFileSync(process.execPath, [join(__dirname, 'sync-watch-version.cjs')], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(__dirname, 'verify-watch-config.cjs')], { stdio: 'inherit' });
  execFileSync('swift', ['test', '--package-path', join(__dirname, '..')], { stdio: 'inherit' });
}
