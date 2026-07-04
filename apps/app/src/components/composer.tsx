/**
 * 입력 바 — 사진/이모지/텍스트 전송 (글래스 표면 위)
 *
 * - 자동으로 자라는 입력창 (최대 5줄 정도)
 * - 전송 버튼: 인디고 필, 눌림 스케일 + 햅틱
 * - 사진: 앨범에서 선택 → /api/images 업로드 → 이미지 메시지 전송
 */
import type { MessageKind } from '@litechat/types';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { authHeaders, unwrap } from '@/lib/api';
import { API_URL } from '@/lib/env';
import { isEmojiOnly } from '@/lib/format';
import { colors, rounded, spacing } from '@/theme/tokens';
import { EmojiPicker } from './emoji-picker';
import { Glass } from './glass';

interface Props {
  onSend: (kind: MessageKind, content: string) => Promise<void>;
  onError: (message: unknown) => void;
}

export function Composer({ onSend, onError }: Props) {
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
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

  return (
    <Glass style={styles.surface}>
      <View style={styles.bar}>
        {/* 사진 */}
        <Pressable
          onPress={() => void pickImage()}
          disabled={uploading}
          accessibilityLabel="사진 보내기"
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
          accessibilityLabel="이모지"
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          <Text style={styles.icon}>😊</Text>
        </Pressable>

        {/* 입력창 — multiline, 자동 성장 */}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="메시지 보내기"
          placeholderTextColor={colors.inkMute}
          multiline
          style={styles.input}
          onFocus={() => setShowEmoji(false)}
        />

        {/* 전송 — 인디고 필 (화면당 하나뿐인 채워진 CTA), 눌림 스케일 */}
        <Pressable
          onPress={() => void submit()}
          disabled={!canSend}
          accessibilityLabel="전송"
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendDisabled,
            pressed && styles.sendPressed,
          ]}
        >
          <Text style={styles.sendArrow}>↑</Text>
        </Pressable>
      </View>

      {showEmoji && <EmojiPicker onPick={(emoji) => setDraft((d) => d + emoji)} />}
    </Glass>
  );
}

const styles = StyleSheet.create({
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
  iconButton: {
    padding: spacing.sm,
    borderRadius: rounded.pill,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: colors.canvasSoft },
  icon: { fontSize: 20 },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 40,
    backgroundColor: colors.canvasSoft,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.ink,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: rounded.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.3 },
  sendPressed: {
    backgroundColor: colors.primaryPress,
    transform: [{ scale: 0.88 }],
  },
  sendArrow: {
    color: colors.onPrimary,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
  },
});
