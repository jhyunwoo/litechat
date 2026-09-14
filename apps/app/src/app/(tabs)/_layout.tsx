/**
 * 탭 레이아웃 — 네이티브 탭 (iOS 26 Liquid Glass 탭바)
 *
 * 뱃지: 채팅 = 전체 안읽음 수, 친구 = 받은 요청 수.
 * 앱 아이콘 배지도 같은 값으로 동기화한다.
 */
import { useTranslation } from '@/lib/i18n';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useConversations, useFriendRequests } from '@/data/data';
import { useBadgeSync } from '@/lib/notifications';
import { useTheme } from '@/theme/theme';

export default function TabLayout() {
  const t = useTranslation();
  const { colors } = useTheme();
  const { data: conversations } = useConversations();
  const { data: requests } = useFriendRequests();

  const unreadTotal = conversations?.reduce((sum, conv) => sum + conv.unread, 0) ?? 0;
  const incomingCount = requests?.incoming.length ?? 0;

  // 앱 아이콘 배지 = 전체 안읽음 수
  useBadgeSync(conversations);

  return (
    <NativeTabs tintColor={colors.link}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('채팅')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="message.fill" />
        {unreadTotal > 0 && (
          <NativeTabs.Trigger.Badge>
            {unreadTotal > 99 ? '99+' : String(unreadTotal)}
          </NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Label>{t('친구')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2.fill" />
        {incomingCount > 0 && (
          <NativeTabs.Trigger.Badge>{String(incomingCount)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>{t('프로필')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
