const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Resolve path to built CLI dist/cli.js.
 *
 * Dev mode: uses the project root dist/cli.js.
 * Packaged mode: uses the bundled resources/cli/dist/cli.js.
 */
function resolveCliPath() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'cli', 'dist', 'cli.js');
    if (fs.existsSync(bundled)) return bundled;
    throw new CliMissingError(
      `内置 CLI 缺失：${bundled}\n请重新安装客户端或联系管理员。`,
    );
  }

  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const devPath = path.join(rootDir, 'dist', 'cli.js');
  if (fs.existsSync(devPath)) return devPath;
  throw new CliMissingError(
    `CLI 构建产物未找到：${devPath}\n请先运行 npm run build 构建 CLI。`,
  );
}

function getRootDir() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

class CliMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliMissingError';
    this.code = 'CLI_MISSING';
  }
}

module.exports = { resolveCliPath, getRootDir, CliMissingError };
