/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'LiteChatWatch',
  displayName: 'LiteChat',
  bundleIdentifier: '.watch',
  deploymentTarget: '10.0',
  icon: '../../assets/images/icon.png',
  frameworks: ['SwiftUI', 'WatchKit', 'UserNotifications', 'Security', 'Network', 'ImageIO'],
  entitlements: { 'aps-environment': 'development' },
};
