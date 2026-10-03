/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = () => ({
  type: 'watch',
  name: 'LiteChatWatch',
  displayName: 'LiteChat',
  bundleIdentifier: '.watch',
  deploymentTarget: '10.0',
  icon: '../../assets/images/icon.png',
  frameworks: ['SwiftUI', 'WatchKit', 'UserNotifications', 'Security', 'Network', 'ImageIO'],
  entitlements: {
    // TestFlight/App Store distribution requires the production APNs environment;
    // local simulator builds keep the development environment.
    'aps-environment':
      // Read only eas.json profile env (injected identically during the local
      // fingerprint pass and on the EAS worker); EAS_BUILD* differs between the
      // two and breaks the fingerprint runtimeVersion check.
      process.env.WATCH_APS_ENV === 'production' ? 'production' : 'development',
    // The watch declares its own group first so unqualified keychain items stay
    // private, then the companion's group so the iPhone's shared session item is
    // readable once iCloud Keychain syncs it.
    'keychain-access-groups': [
      '$(AppIdentifierPrefix)kr.moveto.litechat.watch',
      '$(AppIdentifierPrefix)kr.moveto.litechat',
    ],
  },
});
