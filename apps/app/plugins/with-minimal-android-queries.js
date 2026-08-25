const { withAndroidManifest } = require('expo/config-plugins');

// expo-image-picker and expo-file-system expose optional camera/video/tree
// integrations that litechat never calls. Keep only the visibility intents used
// by HTTPS links, gallery selection and the explicit share sheet.
const UNUSED_ACTIONS = new Set([
  'android.intent.action.OPEN_DOCUMENT_TREE',
  'android.media.action.IMAGE_CAPTURE',
  'android.media.action.ACTION_VIDEO_CAPTURE',
]);

module.exports = function withMinimalAndroidQueries(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const queries = androidConfig.modResults.manifest.queries ?? [];

    const minimalQueries = queries
      .map((query) => ({
        ...query,
        intent: query.intent?.filter(
          (intent) =>
            !intent.action?.some((action) => UNUSED_ACTIONS.has(action.$?.['android:name'])),
        ),
      }))
      .filter(
        (query) =>
          (query.intent?.length ?? 0) > 0 ||
          (query.package?.length ?? 0) > 0 ||
          (query.provider?.length ?? 0) > 0,
      );

    const queryGroup = minimalQueries[0] ?? { intent: [] };
    queryGroup.intent ??= [];
    for (const actionName of UNUSED_ACTIONS) {
      queryGroup.intent.push({
        $: { 'tools:node': 'remove' },
        action: [{ $: { 'android:name': actionName } }],
      });
    }
    if (minimalQueries.length === 0) minimalQueries.push(queryGroup);
    androidConfig.modResults.manifest.queries = minimalQueries;

    return androidConfig;
  });
};
