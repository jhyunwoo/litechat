const fs = require('node:fs');
const path = require('node:path');
const { XcodeProject } = require('@bacons/xcode');
const xcodeParse = require('@bacons/xcode/json');
const { readWatchVersions } = require('./watch-version.cjs');

// Run against a generated project before compiling: it copies the companion's authoritative
// version onto the Watch target, which Xcode expands into the Watch app's Info.plist.
const root = path.resolve(__dirname, '..');
const pbxproj = path.join(root, 'ios/litechat.xcodeproj/project.pbxproj');
const project = XcodeProject.open(pbxproj);
const { watch, buildNumber, marketingVersion } = readWatchVersions(project, root);
let changed = false;
for (const configuration of watch.props.buildConfigurationList.props.buildConfigurations) {
  const settings = configuration.props.buildSettings;
  if (String(settings.CURRENT_PROJECT_VERSION) !== buildNumber) {
    settings.CURRENT_PROJECT_VERSION = buildNumber;
    changed = true;
  }
  if (String(settings.MARKETING_VERSION) !== marketingVersion) {
    settings.MARKETING_VERSION = marketingVersion;
    changed = true;
  }
}
if (changed) fs.writeFileSync(pbxproj, xcodeParse.build(project.toJSON()));
console.log(
  `Watch version ${changed ? 'synced to' : 'already matches'} companion ${marketingVersion} (${buildNumber}).`,
);
