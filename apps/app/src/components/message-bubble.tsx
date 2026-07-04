/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션 (웹 MessageBubble 포팅)
 *
 * - 내 메시지: 인디고 말풍선, 오른쪽 정렬
 * - 상대 메시지: canvas-soft 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 썸네일 (디스크 캐시 — 썸네일은 불변), 탭하면 뷰어
 * - 등장 애니메이션은 마운트 이후 추가된 메시지에만 (히스토리는 애니메이션 없음)
 */
import type { WireMessage } from '@litechat/types';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { withSpring, type EntryAnimationsValues } from 'react-native-reanimated';
import { authHeaders } from '@/lib/api';
import { imageUrl } from '@/lib/env';
import { formatTime, isEmojiOnly } from '@/lib/format';
import { colors, spacing } from '@/theme/tokens';

/** 이미지 말풍선 최대 크기 */
const MAX_IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 288;

interface Props {
  message: WireMessage;
  mine: boolean;
  /** 아직 서버 확인(ack) 전인지 — 반투명 표시 */
  pending: boolean;
  /** 상대가 이 메시지까지 읽었는지 (내 메시지에만 의미 있음) */
  read: boolean;
  /** 연속 메시지 묶음의 마지막인지 (꼬리/시간 표시) */
  isTail: boolean;
  /** 마운트 이후 도착한 새 메시지인지 — true면 스프링 등장 */
  animate: boolean;
  onImagePress: (message: WireMessage) => void;
}

/** 아래에서 살짝 튀어오르는 스프링 등장 (iMessage 느낌) */
function springEntry(values: EntryAnimationsValues) {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 14 }, { scale: 0.9 }],
    },
    animations: {
      opacity: withSpring(1, { stiffness: 500, damping: 32, mass: 0.7 }),
      transform: [
        { translateY: withSpring(0, { stiffness: 500, damping: 32, mass: 0.7 }) },
        { scale: withSpring(1, { stiffness: 500, damping: 32, mass: 0.7 }) },
      ],
    },
  };
}

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  pending,
  read,
  isTail,
  animate,
  onImagePress,
}: Props) {
  const emojiOnly = message.k === 'e' || (message.k === 't' && isEmojiOnly(message.x));

  /** 이미지 표시 크기 — 원본 비율 유지, 최대 크기 제한 */
  function imageSize(): { width: number; height: number } {
    const im = message.im!;
    const scale = Math.min(MAX_IMAGE_WIDTH / im.w, MAX_IMAGE_HEIGHT / im.h, 1);
    return { width: Math.round(im.w * scale), height: Math.round(im.h * scale) };
  }

  return (
    <Animated.View
      entering={animate ? springEntry : undefined}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowPeer,
        { marginBottom: isTail ? spacing.sm : spacing.xxs },
        pending && styles.pending,
      ]}
    >
      <View style={[styles.group, mine && styles.groupMine]}>
        {message.k === 'i' && message.im ? (
          <Pressable onPress={() => onImagePress(message)}>
            <Image
              source={{ uri: imageUrl(message.im.id, 'thumb'), headers: authHeaders() }}
              style={[styles.image, imageSize()]}
              cachePolicy="disk"
              transition={150}
              accessibilityLabel="사진"
            />
          </Pressable>
        ) : emojiOnly ? (
          <Text style={styles.bigEmoji}>{message.x}</Text>
        ) : (
          <View
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubblePeer,
              isTail && (mine ? styles.tailMine : styles.tailPeer),
            ]}
          >
            <Text style={mine ? styles.textMine : styles.textPeer}>{message.x}</Text>
          </View>
        )}

        {/* 시간 + 읽음 표시 (묶음 마지막에만) */}
        {isTail && (
          <View style={styles.meta}>
            {mine && read && <Text style={styles.readLabel}>읽음</Text>}
            <Text style={styles.time}>{formatTime(message.ts)}</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  rowMine: { justifyContent: 'flex-end' },
  rowPeer: { justifyContent: 'flex-start' },
  pending: { opacity: 0.6 },
  group: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '78%',
  },
  groupMine: { flexDirection: 'row-reverse' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: colors.primary },
  bubblePeer: { backgroundColor: colors.canvasSoft },
  /** 묶음 마지막 말풍선의 꼬리 — 모서리 하나만 각지게 */
  tailMine: { borderBottomRightRadius: 6 },
  tailPeer: { borderBottomLeftRadius: 6 },
  textMine: {
    color: colors.onPrimary,
    fontSize: 15,
    lineHeight: 20,
  },
  textPeer: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 20,
  },
  bigEmoji: {
    fontSize: 48,
    lineHeight: 56,
    paddingHorizontal: spacing.xs,
  },
  image: {
    borderRadius: 18,
    backgroundColor: colors.canvasSoft,
  },
  meta: {
    marginBottom: 2,
    alignItems: 'flex-end',
  },
  readLabel: {
    fontSize: 10,
    color: colors.primarySoft,
    fontWeight: '400',
  },
  time: {
    fontSize: 10,
    color: colors.inkMute,
    fontVariant: ['tabular-nums'],
  },
});
