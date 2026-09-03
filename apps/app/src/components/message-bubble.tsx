/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션 (웹 MessageBubble 포팅)
 *
 * - 내 메시지: 인디고 말풍선, 오른쪽 정렬
 * - 상대 메시지: canvas-soft 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 썸네일 (디스크 캐시 — 썸네일은 불변), 탭하면 뷰어
 * - 등장 애니메이션은 마운트 이후 추가된 메시지에만 (히스토리는 애니메이션 없음)
 * - 답장: 말풍선 위에 인용 한 줄. 스와이프(상대 →, 내 것 ←)로 답장 대상을 고르고,
 *   길게 눌러 신고와는 Gesture.Race로 묶어 둘 중 하나만 발동한다.
 */
import type { WireMessage } from '@litechat/types';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type EntryAnimationsValues,
} from 'react-native-reanimated';
import { authHeaders } from '@/lib/api';
import { imageUrl } from '@/lib/env';
import { formatTime, isEmojiOnly } from '@/lib/format';
import { replySwipe } from '@/lib/gesture';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

/** 이미지 말풍선 최대 크기 */
const MAX_IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 288;

/** 인용문 표시용 — 원본 해석과 이름 붙이기는 MessageList가 미리 끝낸다 */
export interface QuoteView {
  id: number;
  name: string;
  text: string;
}

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
  /** 이 메시지가 인용하는 원본 (해석 실패 시 undefined) */
  quote?: QuoteView;
  /** 점프해 온 직후인지 — 잠깐 배경을 밝힌다 */
  highlighted: boolean;
  onImagePress: (message: WireMessage) => void;
  onLongPress?: (message: WireMessage) => void;
  onReply: (message: WireMessage) => void;
  onQuotePress: (messageId: number) => void;
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
  quote,
  highlighted,
  onImagePress,
  onLongPress,
  onReply,
  onQuotePress,
}: Props) {
  const styles = useStyles();
  const emojiOnly = message.k === 'e' || (message.k === 't' && isEmojiOnly(message.x));

  const translateX = useSharedValue(0);
  // 아직 서버 확인 전(음수 id)인 메시지는 답장 대상이 될 수 없다 — 서버가 400을 준다.
  const canReply = message.id > 0;

  /** 임계값을 넘겼을 때 JS 스레드에서 실행되는 마무리 */
  function fireReply() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply(message);
  }

  /** 길게 눌러 신고 (상대 메시지에만 붙는다) */
  function fireLongPress() {
    onLongPress?.(message);
  }

  // activeOffsetX/failOffsetY로 FlashList의 세로 스크롤과 다투지 않게 한다.
  const pan = Gesture.Pan()
    .enabled(canReply)
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translateX.value = replySwipe(event.translationX, event.translationY, mine).offset;
    })
    .onEnd((event) => {
      const { ready } = replySwipe(event.translationX, event.translationY, mine);
      translateX.value = withSpring(0, { stiffness: 500, damping: 32, mass: 0.7 });
      if (ready) runOnJS(fireReply)();
    });

  // Race: 먼저 활성화된 제스처가 나머지를 취소한다 (스와이프 중에 신고창이 뜨지 않게).
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => {
      runOnJS(fireLongPress)();
    });
  const gesture = onLongPress ? Gesture.Race(pan, longPress) : pan;

  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  /** 이미지 표시 크기 — 원본 비율 유지, 최대 크기 제한 */
  function imageSize(): { width: number; height: number } {
    const im = message.im!;
    const scale = Math.min(MAX_IMAGE_WIDTH / im.w, MAX_IMAGE_HEIGHT / im.h, 1);
    return { width: Math.round(im.w * scale), height: Math.round(im.h * scale) };
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        entering={animate ? springEntry : undefined}
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowPeer,
          { marginBottom: isTail ? spacing.sm : spacing.xxs },
          pending && styles.pending,
          highlighted && styles.highlighted,
          swipeStyle,
        ]}
      >
        <View style={[styles.group, mine && styles.groupMine]}>
          <View style={mine ? styles.stackMine : styles.stack}>
            {/* 인용문 — 원본을 못 찾으면 플레이스홀더를 보여준다 */}
            {message.r !== undefined && (
              <Pressable
                onPress={() => onQuotePress(message.r!)}
                style={styles.quote}
                accessibilityRole="button"
                accessibilityLabel="인용한 원본 메시지로 이동"
              >
                {quote ? <Text style={styles.quoteName}>{quote.name}</Text> : null}
                <Text style={styles.quoteText} numberOfLines={1}>
                  {quote?.text ?? '메시지'}
                </Text>
              </Pressable>
            )}

            {message.k === 'i' && message.im ? (
              <Pressable onPress={() => onImagePress(message)}>
                <Image
                  source={{ uri: imageUrl(message.im.id, 'thumb'), headers: authHeaders() }}
                  style={[styles.image, imageSize()]}
                  // memory-disk: 썸네일은 불변이라 디스크 캐시로 재다운로드는 이미 막고 있었지만,
                  // 메모리 캐시가 없으면 위아래로 스크롤할 때마다 디스크에서 다시 읽고 **다시 디코딩**한다.
                  // 셀을 재활용하는 리스트에서 이 디코딩이 스크롤 프레임을 갉아먹는다.
                  // 640px 썸네일이라 항목당 메모리 비용은 작다.
                  cachePolicy="memory-disk"
                  // 재활용된 셀이 이전 메시지의 사진을 잠깐 보여주지 않게 한다.
                  recyclingKey={message.im.id}
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
          </View>

          {/* 시간 + 읽음 표시 (묶음 마지막에만) */}
          {isTail && (
            <View style={styles.meta}>
              {mine && read && <Text style={styles.readLabel}>읽음</Text>}
              <Text style={styles.time}>{formatTime(message.ts)}</Text>
            </View>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const useStyles = makeStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  rowMine: { justifyContent: 'flex-end' },
  rowPeer: { justifyContent: 'flex-start' },
  pending: { opacity: 0.6 },
  /** 점프해 온 메시지를 잠깐 밝힌다 */
  highlighted: { backgroundColor: colors.canvasSoft, borderRadius: 12 },
  group: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '78%',
  },
  groupMine: { flexDirection: 'row-reverse' },
  /** 인용문 + 말풍선을 세로로 쌓는다 */
  stack: { alignItems: 'flex-start', flexShrink: 1 },
  stackMine: { alignItems: 'flex-end', flexShrink: 1 },
  quote: {
    marginBottom: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.primarySoft,
    backgroundColor: colors.canvasSoft,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  quoteName: { fontSize: 11, fontWeight: '500', color: colors.primarySoft },
  quoteText: { fontSize: 11, color: colors.inkMute },
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
}));
