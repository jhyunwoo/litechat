const { withPodfile } = require('expo/config-plugins');
const { withXcodeProjectBeta } = require('@bacons/apple-targets/build/with-bacons-xcode');

// Keep the native environment explicit and verify it against the signed archive.
// All current EAS profiles distribute ad-hoc or App Store builds (production APNs).
module.exports = function withLiteChatWatch(config) {
  const api =
    process.env.WATCH_API_URL || process.env.EXPO_PUBLIC_API_URL || 'https://chat.moveto.kr';
  if (!api.startsWith('https://')) throw new Error('Watch requires an HTTPS API URL');
  config = withPodfile(config, (config) => {
    const marker = '# LiteChat Watch owns its native privacy manifest';
    if (!config.modResults.contents.includes(marker)) {
      const hook = /react_native_post_install\([\s\S]*?\n\s*\)/;
      if (!hook.test(config.modResults.contents))
        throw new Error('React Native post_install hook not found');
      config.modResults.contents = config.modResults.contents.replace(
        hook,
        (match) =>
          match +
          `
    ${marker}
    installer.aggregate_targets.map(&:user_project).uniq.each do |project|
      project.native_targets.select { |target| target.name == 'LiteChatWatch' }.each do |target|
        target.resources_build_phase.files.to_a.each do |file|
          if file.file_ref && File.basename(file.file_ref.path.to_s) == 'PrivacyInfo.xcprivacy'
            file.remove_from_project
          end
        end
      end
      project.save
    end`,
      );
    }
    return config;
  });
  return withXcodeProjectBeta(config, async (config) => {
    const project = config.modResults;
    const target = project.rootObject.props.targets.find((t) => t.props.name === 'LiteChatWatch');
    if (!target) throw new Error('LiteChatWatch target missing');
    target.setBuildSetting('INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp', 'YES');
    target.setBuildSetting('LITECHAT_API_URL', api);
    // Apple requires the Watch app and its companion to carry identical versions. Derive them
    // from the same inputs Expo writes into the companion Info.plist; when EAS assigns a remote
    // build number after generation, scripts/sync-watch-version.cjs re-mirrors it before Xcode runs.
    target.setBuildSetting(
      'CURRENT_PROJECT_VERSION',
      String(process.env.EAS_BUILD_IOS_BUILD_NUMBER || config.ios?.buildNumber || '1'),
    );
    target.setBuildSetting('MARKETING_VERSION', config.ios?.version || config.version || '1.0.0');
    for (const build of target.props.buildConfigurationList.props.buildConfigurations) {
      build.props.buildSettings.LITECHAT_APNS_ENVIRONMENT =
        process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD_PROFILE
          ? 'production'
          : build.props.name === 'Debug'
            ? 'sandbox'
            : 'production';
    }
    const attributes = project.rootObject.props.attributes;
    attributes.TargetAttributes ??= {};
    attributes.TargetAttributes[target.uuid] ??= {};
    attributes.TargetAttributes[target.uuid].SystemCapabilities ??= {};
    attributes.TargetAttributes[target.uuid].SystemCapabilities['com.apple.Push'] = { enabled: 1 };
    // The watch reads the phone's shared session token through the companion's
    // keychain access group, so its App ID needs Keychain Sharing enabled.
    attributes.TargetAttributes[target.uuid].SystemCapabilities['com.apple.Keychain'] = { enabled: 1 };
    return config;
  });
};
