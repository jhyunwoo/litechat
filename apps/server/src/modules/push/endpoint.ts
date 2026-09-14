/** Only browser push providers may receive server-side notification requests. */
export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
      return false;
    return (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'push.services.mozilla.com' ||
      url.hostname === 'web.push.apple.com'
    );
  } catch {
    return false;
  }
}
