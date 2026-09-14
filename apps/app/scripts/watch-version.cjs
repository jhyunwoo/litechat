const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;

// Apple requires a Watch app and its companion to ship identical versions (ITMS-90473), but
// remote and auto-incremented EAS versions reach the companion alone. The build number EAS
// resolved for this job, or otherwise the companion's generated plist, is authoritative.
function readWatchVersions(project, root) {
  const applications = project.rootObject.props.targets.filter(
    (target) => target.props.productType === 'com.apple.product-type.application',
  );
  const watch = applications.find((target) => target.props.name === 'LiteChatWatch');
  const companion = applications.find(
    (target) =>
      target !== watch &&
      target.getDefaultConfiguration().props.buildSettings.SDKROOT !== 'watchos',
  );
  if (!watch || !companion) throw new Error('Expected the companion iOS target and LiteChatWatch');
  const settings = companion.getDefaultConfiguration().props.buildSettings;
  const info = plist.parse(
    fs.readFileSync(path.join(root, 'ios', settings.INFOPLIST_FILE), 'utf8'),
  );
  // The companion plist may hold a literal version or defer to its own build setting.
  const resolve = (value) => {
    const variable = /^\$\((\w+)\)$/.exec(String(value ?? ''));
    return String((variable ? settings[variable[1]] : value) ?? '');
  };
  const buildNumber = process.env.EAS_BUILD_IOS_BUILD_NUMBER || resolve(info.CFBundleVersion);
  const marketingVersion = resolve(info.CFBundleShortVersionString);
  if (!buildNumber || !marketingVersion)
    throw new Error('Companion version missing from the generated Info.plist');
  return { watch, buildNumber, marketingVersion };
}

module.exports = { readWatchVersions };
