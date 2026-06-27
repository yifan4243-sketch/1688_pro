const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Pure function: resolve CLI path given runtime parameters.
 * Testable without Electron app state.
 *
 * @param {{ isPackaged: boolean, resourcesPath: string, rootDir: string }} opts
 * @returns {string}
 */
function resolveCliPathForMode({ isPackaged, resourcesPath, rootDir }) {
  if (isPackaged) {
    const bundled = path.join(resourcesPath, 'cli', 'dist', 'cli.js');
    if (fs.existsSync(bundled)) return bundled;
    throw new CliMissingError(
      `内置 CLI 缺失：${bundled}\n请重新安装客户端或联系管理员。`,
    );
  }

  const devPath = path.join(rootDir, 'dist', 'cli.js');
  if (fs.existsSync(devPath)) return devPath;
  throw new CliMissingError(
    `CLI 构建产物未找到：${devPath}\n请先运行 npm run build 构建 CLI。`,
  );
}

/**
 * Production resolver using Electron app state.
 */
function resolveCliPath() {
  return resolveCliPathForMode({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    rootDir: path.resolve(__dirname, '..', '..', '..'),
  });
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

module.exports = { resolveCliPath, resolveCliPathForMode, getRootDir, CliMissingError };
