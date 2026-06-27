// electron-builder afterPack hook — copies root package.json into the app
// directory when npm "files" filtering strips it (electron-builder quirk).
const fs = require('fs');
const path = require('path');

/**
 * @param {import('app-builder-lib').AfterPackContext} context
 */
exports.default = async function (context) {
  const appDir = context.appOutDir;
  const resourcesAppDir = path.join(appDir, 'resources', 'app');
  const srcPkg = path.join(context.packager.projectDir, 'package.json');
  const dstPkg = path.join(resourcesAppDir, 'package.json');

  if (fs.existsSync(srcPkg) && !fs.existsSync(dstPkg)) {
    fs.copyFileSync(srcPkg, dstPkg);
    console.log('[afterPack] copied package.json → resources/app/package.json');
  }
};
