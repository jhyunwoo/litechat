/**
 * 입력 바 — 사진/이모지/텍스트 전송 (글래스 표면 위)
 *
 * - 자동으로 자라는 입력창 (최대 5줄 정도)
 * - 사진/이모지/입력창/전송은 모두 CONTROL_SIZE(44pt)로 높이를 맞춘다 —
 *   DESIGN.md의 최소 터치 타깃(44x44)이자 search-input 높이 규칙
 * - 전송 버튼: Action Blue 필, 입력이 생기면 스프링으로 커지며 또렷해진다
 * - 사진: 앨범에서 선택 → /api/images 업로드 → 이미지 메시지 전송
 */
import { useTranslation } from '@/lib/i18n';
import type { MessageKind } from '@litechat/types';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { authHeaders, unwrap } from '@/lib/api';
import { API_URL } from '@/lib/env';
import { isEmojiOnly } from '@/lib/format';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';
import { EmojiPicker } from './emoji-picker';
import { Glass } from './glass';

/** 입력 바의 모든 컨트롤이 공유하는 높이 — DESIGN.md 최소 터치 타깃 44x44 */
const CONTROL_SIZE = 44;
/** 한 줄일 때 입력창이 정확히 CONTROL_SIZE가 되도록 맞춘 값 (44 = 11 + 22 + 11) */
const INPUT_LINE_HEIGHT = 22;
const INPUT_PADDING_V = (CONTROL_SIZE - INPUT_LINE_HEIGHT) / 2;

/**
 * 하단 세이프 에어리어를 뺀 입력 바의 기본 높이 — 한 줄 입력, 답장 바/이모지 없음 기준.
 *
 * 채팅방이 메시지 리스트의 하단 여백(contentInset)을 **첫 프레임부터** 잡는 데 쓴다.
 * onLayout 실측만 기다리면 그 사이에 FlashList가 "여백 0" 상태로 바닥을 잡아 버려서,
 * 마지막 메시지가 입력 바 뒤에 깔린 채로 방이 열린다. 실측이 오면 그 값으로 덮는다.
 */
export const COMPOSER_BAR_HEIGHT = StyleSheet.hairlineWidth + spacing.sm * 2 + CONTROL_SIZE;

/** 전송 버튼이 살아나는 팝 — 크기는 항상 CONTROL_SIZE라 정렬은 흔들리지 않는다 */
const SEND_POP_SPRING = { stiffness: 500, damping: 18, mass: 0.5 } as const;

interface Props {
  onSend: (kind: MessageKind, content: string) => Promise<void>;
  onError: (message: unknown) => void;
  /** 답장 중이면 인용 미리보기 (보낸이 이름 + 한 줄) */
  replyPreview?: { name: string; text: string };
  onCancelReply: () => void;
}

export function Composer({ onSend, onError, replyPreview, onCancelReply }: Props) {
  const t = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);

  /** 텍스트/이모지 전송 */
  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setShowEmoji(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onSend(isEmojiOnly(text) ? 'e' : 't', text);
    } catch (error) {
      onError(error);
      setDraft(text); // 실패하면 입력을 복구한다.
    }
  }

  /** 사진 선택 → 업로드 → 이미지 메시지 전송 */
  async function pickImage() {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
    } catch {
      onError(t('사진 보관함을 열 수 없어요. 기기 설정에서 litechat의 사진 접근을 확인해 주세요.'));
      return;
    }
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUploading(true);
    try {
      const form = new FormData();
      // RN FormData는 { uri, name, type } 객체를 파일로 직렬화한다.
      form.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const res = await fetch(`${API_URL}/api/images`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const { image } = await unwrap<{ image: { id: string } }>(res);
      await onSend('i', image.id);
    } catch (error) {
      onError(error);
    } finally {
      setUploading(false);
    }
  }

  const canSend = draft.trim().length > 0;

  // 보낼 내용이 생기는 순간 전송 버튼이 또렷해지며 한 번 톡 튀어오른다.
  const sendOpacity = useSharedValue(0.35);
  const sendScale = useSharedValue(1);
  useEffect(() => {
    sendOpacity.set(withTiming(canSend ? 1 : 0.35, { duration: 160 }));
    if (canSend) {
      sendScale.set(
        withSequence(withTiming(1.12, { duration: 110 }), withSpring(1, SEND_POP_SPRING)),
      );
    }
  }, [canSend, sendOpacity, sendScale]);
  const sendStyle = useAnimatedStyle(() => ({
    opacity: sendOpacity.value,
    transform: [{ scale: sendScale.value }],
  }));

  return (
    <Glass style={styles.surface}>
      {/* 답장 바 — 답장 대상이 정해져 있을 때만 */}
      {replyPreview && (
        <View style={styles.replyBar}>
          <View style={styles.replyText}>
            <Text style={styles.replyName}>
              {t('{name}에게 답장', { name: replyPreview.name })}
            </Text>
            <Text style={styles.replyPreview} numberOfLines={1}>
              {replyPreview.text}
            </Text>
          </View>
          <Pressable
            onPress={onCancelReply}
            accessibilityLabel={t('답장 취소')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
          >
            <Text style={styles.icon}>✕</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.bar}>
        {/* 사진 */}
        <Pressable
          onPress={() => void pickImage()}
          disabled={uploading}
          accessibilityLabel={t('사진 보내기')}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.inkMute} />
          ) : (
            <Text style={styles.icon}>📷</Text>
          )}
        </Pressable>

        {/* 이모지 토글 */}
        <Pressable
          onPress={() => setShowEmoji((v) => !v)}
          accessibilityLabel={t('이모지')}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          <Text style={styles.icon}>😊</Text>
        </Pressable>

        {/* 입력창 — multiline, 자동 성장 */}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('메시지 보내기')}
          placeholderTextColor={colors.inkMute}
          multiline
          style={styles.input}
          onFocus={() => setShowEmoji(false)}
        />

        {/* 전송 — Action Blue 필 (화면당 하나뿐인 채워진 CTA), 눌림 스케일 */}
        <Animated.View style={sendStyle}>
          <Pressable
            onPress={() => void submit()}
            disabled={!canSend}
            accessibilityLabel={t('전송')}
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed]}
          >
            <Text style={styles.sendArrow}>↑</Text>
          </Pressable>
        </Animated.View>
      </View>

      {showEmoji && <EmojiPicker onPick={(emoji) => setDraft((d) => d + emoji)} />}
    </Glass>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  surface: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingTop: spacing.xs,
  },
  replyText: {
    flex: 1,
    borderLeftWidth: 2,
    borderLeftColor: colors.primarySoft,
    paddingLeft: spacing.sm,
  },
  replyName: { fontSize: 11, fontWeight: '500', color: colors.primarySoft },
  replyPreview: { fontSize: 12, color: colors.inkMute },
  iconButton: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: rounded.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: colors.canvasSoft, transform: [{ scale: 0.95 }] },
  icon: { fontSize: 20, lineHeight: 24 },
  input: {
    flex: 1,
    maxHeight: 110,
    // 한 줄일 때 정확히 CONTROL_SIZE — 전송 버튼/아이콘과 같은 높이로 맞춘다.
    minHeight: CONTROL_SIZE,
    backgroundColor: colors.canvasSoft,
    // 한 줄에서는 완전한 필, 여러 줄로 자라면 라운드 사각형이 된다.
    borderRadius: CONTROL_SIZE / 2,
    paddingHorizontal: spacing.lg,
    paddingTop: INPUT_PADDING_V,
    paddingBottom: INPUT_PADDING_V,
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    // 안드로이드의 기본 폰트 패딩이 높이를 44에서 밀어내지 않도록 끈다.
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: colors.ink,
  },
  sendButton: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: rounded.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: {
    backgroundColor: colors.primaryPress,
    // DESIGN.md의 시스템 공통 눌림 마이크로 인터랙션
    transform: [{ scale: 0.95 }],
  },
  sendArrow: {
    color: colors.onPrimary,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
  },
}));
