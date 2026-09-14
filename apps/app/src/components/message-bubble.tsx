/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션 (웹 MessageBubble 포팅)
 *
 * - 내 메시지: 인디고 말풍선, 오른쪽 정렬
 * - 상대 메시지: canvas-soft 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 썸네일 (인증 재검증을 위해 캐시하지 않음), 탭하면 뷰어
 * - 등장 애니메이션은 마운트 이후 추가된 메시지에만 (히스토리는 애니메이션 없음)
 * - 답장: 말풍선 위에 인용 한 줄. 스와이프(상대 →, 내 것 ←)로 답장 대상을 고르고,
 *   길게 눌러 신고와는 Gesture.Race로 묶어 둘 중 하나만 발동한다.
 * - 제스처는 행 전체가 아니라 말풍선 묶음에만 붙는다. 화면 왼쪽 끝은 iOS 뒤로가기
 *   (엣지 스와이프) 몫으로 비워 두기 위함이다 — BACK_GESTURE_EDGE 참고.
 */
import { useTranslation, useLocale } from '@/lib/i18n';
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

/**
 * 화면 왼쪽 끝에서 iOS 뒤로가기 엣지 스와이프가 시작되는 구간의 폭 (px).
 *
 * RNGH 핸들러는 UIKit의 interactivePopGestureRecognizer와 동시 인식/실패 관계를 맺지 않고
 * (RNGestureHandler.mm의 shouldRecognizeSimultaneously… 는 RNGH 핸들러가 아닌 인식기에 NO를 준다),
 * react-native-screens도 엣지 인식기에 UIScrollView 팬보다만 우선권을 준다(RNSScreenStack.mm).
 * 둘은 배타적으로 경쟁하므로, 답장 스와이프가 이 구간을 덮으면 화면이 뒤로 가지 않는다.
 *
 * 그래서 답장 제스처는 말풍선 묶음에만 붙인다 — 행 전체를 덮으면 오른쪽 정렬인 내 말풍선
 * 옆의 빈 공간까지 제스처 영역이 되어, 정작 뒤로가기를 시작하는 자리를 잡아먹는다.
 * UIKit이 이 구간의 폭을 공개하지 않아 실측치(약 20px)에 여유를 둔 값이다.
 */
const BACK_GESTURE_EDGE = 30;

/**
 * 상대 말풍선이 위 구간과 겹치는 만큼 — 이 폭 안에서 시작한 터치는 답장 스와이프가 받지 않는다.
 *
 * 상대 말풍선은 왼쪽 정렬이라 행 패딩(spacing.md)만큼만 안쪽에서 시작하므로 엣지 구간과 겹친다.
 * 음수 hitSlop은 "이 영역에서 시작한 터치는 받지 않는다"는 뜻이다
 * (RNGestureHandler.mm의 gestureRecognizer:shouldReceiveTouch:).
 * 내 말풍선은 오른쪽 끝에 있어 겹치지 않으므로 이 여백이 필요 없다.
 */
const PEER_BUBBLE_EDGE_INSET = BACK_GESTURE_EDGE - spacing.md;

/** 이만큼 가로로 끌면 답장 스와이프가 활성화된다 (px) */
const REPLY_SWIPE_ACTIVATE = 15;

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
  const t = useTranslation();
  const locale = useLocale();
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
    // 답장이 될 수 있는 방향(상대 →, 내 것 ←)으로만 활성화한다. 반대 방향은 replySwipe가
    // 어차피 0을 돌려주므로, 활성화해 봐야 뒤로가기 스와이프만 잡아먹는다.
    .activeOffsetX(mine ? -REPLY_SWIPE_ACTIVATE : REPLY_SWIPE_ACTIVATE)
    .failOffsetY([-10, 10])
    // 상대 말풍선의 왼쪽 끝은 뒤로가기 엣지 구간과 겹친다 — 겹치는 만큼은 시스템에 양보한다.
    .hitSlop(mine ? undefined : { left: -PEER_BUBBLE_EDGE_INSET })
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
    <Animated.View
      entering={animate ? springEntry : undefined}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowPeer,
        { marginBottom: isTail ? spacing.sm : spacing.xxs },
        pending && styles.pending,
        highlighted && styles.highlighted,
      ]}
    >
      {/* 제스처는 말풍선 묶음에만 — 행 전체를 덮으면 화면 왼쪽 끝의 뒤로가기 스와이프를 가로챈다 */}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.group, mine && styles.groupMine, swipeStyle]}>
          <View style={mine ? styles.stackMine : styles.stack}>
            {/* 인용문 — 원본을 못 찾으면 플레이스홀더를 보여준다 */}
            {message.r !== undefined && (
              <Pressable
                onPress={() => onQuotePress(message.r!)}
                style={styles.quote}
                accessibilityRole="button"
                accessibilityLabel={t('인용한 원본 메시지로 이동')}
              >
                {quote ? <Text style={styles.quoteName}>{quote.name}</Text> : null}
                <Text style={styles.quoteText} numberOfLines={1}>
                  {quote?.text ?? t('메시지')}
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
                  cachePolicy="none"
                  // 재활용된 셀이 이전 메시지의 사진을 잠깐 보여주지 않게 한다.
                  recyclingKey={message.im.id}
                  transition={150}
                  accessibilityLabel={t('사진')}
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
              {mine && read && <Text style={styles.readLabel}>{t('읽음')}</Text>}
              <Text style={styles.time}>{formatTime(message.ts, locale)}</Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
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
