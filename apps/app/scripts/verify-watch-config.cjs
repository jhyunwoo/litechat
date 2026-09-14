const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { XcodeProject } = require('@bacons/xcode');
const plist = require('@expo/plist').default;
const { readWatchVersions } = require('./watch-version.cjs');
const root = path.resolve(__dirname, '..');
const project = XcodeProject.open(path.join(root, 'ios/litechat.xcodeproj/project.pbxproj'));
const target = project.rootObject.props.targets.find((t) => t.props.name === 'LiteChatWatch');
assert(target, 'Watch target missing');
assert.equal(target.props.productType, 'com.apple.product-type.application');
// Apple rejects an archive whose Watch app version differs from its companion's;
// scripts/sync-watch-version.cjs mirrors the companion's version before compiling.
const { buildNumber, marketingVersion } = readWatchVersions(project, root);
const info = plist.parse(
  fs.readFileSync(path.join(root, 'targets/litechat-watch/Info.plist'), 'utf8'),
);
assert.equal(info.WKRunsIndependentlyOfCompanionApp, true);
assert.equal(info.WKCompanionAppBundleIdentifier, 'kr.moveto.litechat');
assert.notEqual(info.WKWatchOnly, true);
assert.equal(info.CFBundleDevelopmentRegion, 'en');
assert.deepEqual(info.CFBundleLocalizations, ['en', 'ko']);
// apple-targets 5 uses synchronized groups: resources are discovered by Xcode,
// so localized files must be under this target and not membership exceptions.
const sourceGroup = target.props.fileSystemSynchronizedGroups?.find(
  (group) => group.props.path === 'litechat-watch',
);
assert(sourceGroup, 'Watch synchronized source/resource group missing');
for (const language of ['en', 'ko']) {
  const resource = `${language}.lproj/Localizable.strings`;
  assert(fs.existsSync(path.join(root, 'targets/litechat-watch', resource)));
  for (const exception of sourceGroup.props.exceptions ?? []) {
    if (exception.props.target?.uuid !== target.uuid) continue;
    assert(!(exception.props.membershipExceptions ?? []).some(
      (excluded) => resource === excluded || resource.startsWith(`${excluded}/`),
    ), `${resource} excluded from Watch resources`);
  }
}
for (const config of target.props.buildConfigurationList.props.buildConfigurations) {
  const s = config.props.buildSettings;
  assert.equal(s.PRODUCT_BUNDLE_IDENTIFIER, 'kr.moveto.litechat.watch');
  assert.equal(s.WATCHOS_DEPLOYMENT_TARGET, '10.0');
  assert.equal(s.SDKROOT, 'watchos');
  assert.equal(s.INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp, 'YES');
  assert.equal(String(s.CURRENT_PROJECT_VERSION), buildNumber);
  assert.equal(String(s.MARKETING_VERSION), marketingVersion);
  assert(s.LITECHAT_API_URL.startsWith('https://'));
  assert(['sandbox', 'production'].includes(s.LITECHAT_APNS_ENVIRONMENT));
  const entitlement = plist.parse(
    fs.readFileSync(path.join(root, 'ios', s.CODE_SIGN_ENTITLEMENTS), 'utf8'),
  );
  assert(['development', 'production'].includes(entitlement['aps-environment']));
}
assert.equal(
  project.rootObject.props.attributes.TargetAttributes[target.uuid].SystemCapabilities[
    'com.apple.Push'
  ].enabled,
  1,
);
const pbx = fs.readFileSync(path.join(root, 'ios/litechat.xcodeproj/project.pbxproj'), 'utf8');
assert(pbx.includes('Embed Watch Content'));
const assets = path.join(root, 'targets/litechat-watch/Assets.xcassets');
// apple-targets writes generated assets under ios/.targets, keeping checked-in source clean.
assert(
  fs.existsSync(assets) ||
    fs.existsSync(path.join(root, 'ios/.targets/LiteChatWatch/Assets.xcassets')),
);
console.log(
  'PASS: modern Watch target, independence, companion, push entitlement, deployment, embedding' +
    ` configuration and version parity (${marketingVersion} / ${buildNumber})`,
);
