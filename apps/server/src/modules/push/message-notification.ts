import type { PublicUser, WireMessage } from '@litechat/types';
import { previewOf } from './preview';

/** Shared semantic identity; provider-specific receipts must not become message IDs. */
export function messageNotification(sender: Pick<PublicUser, 'nickname'>, message: WireMessage) {
  return {
    title: sender.nickname,
    body: previewOf(message),
    c: message.c,
    m: message.id,
    identity: `message-${message.id}`,
    category: 'LITECHAT_MESSAGE',
    thread: `conversation-${message.c}`,
  };
}
