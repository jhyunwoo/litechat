/**
 * 이미지 뷰어 — 전체 화면 모달, 저화질/원본 공유 제공 (웹 ImageViewer 포팅)
 *
 * 파일 크기를 보여줘 데이터 사용량을 예측하게 한다.
 * 저장은 iOS 공유 시트(expo-sharing)로 — 사진 앱 저장/메시지 전달 등 사용자가 고른다.
 */
import type { WireMessage } from '@litechat/types';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { authHeaders } from '@/lib/api';
import { imageUrl } from '@/lib/env';
import { formatBytes } from '@/lib/format';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';

interface Props {
  message: WireMessage | null;
  onClose: () => void;
}

export function ImageViewer({ message, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [busy, setBusy] = useState<'thumb' | 'orig' | null>(null);
  const image = message?.im;

  /** 인증 헤더로 내려받아 캐시에 저장한 뒤 iOS 공유 시트를 연다 */
  async function share(variant: 'thumb' | 'orig') {
    if (!image || busy) return;
    setBusy(variant);
    try {
      const res = await fetch(imageUrl(image.id, variant), { headers: authHeaders() });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const extension = variant === 'thumb' ? 'webp' : 'jpg';
      const file = new File(Paths.cache, `litechat-${image.id}-${variant}.${extension}`);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      await Sharing.shareAsync(file.uri);
    } catch {
      /* 공유 취소/실패는 조용히 무시 */
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={message !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {image && (
          <>
            <Image
              source={{ uri: imageUrl(image.id, 'thumb'), headers: authHeaders() }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="disk"
              accessibilityLabel="사진"
            />
            {/* 다운로드 옵션 — 탭이 배경 닫기로 전파되지 않게 한다 */}
            <View style={styles.actions} onStartShouldSetResponder={() => true}>
              <Pressable
                onPress={() => void share('thumb')}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              >
                {busy === 'thumb' ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.actionText}>저화질 저장 ({formatBytes(image.tb)})</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => void share('orig')}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              >
                {busy === 'orig' ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.actionText}>원본 저장 ({formatBytes(image.ob)})</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </Pressable>
    </Modal>
  );
}

// 전체 화면 사진 뷰어는 두 스킴 모두 의도적으로 어두운 표면을 쓴다 (사진 감상 최적)
const useStyles = makeStyles(({ colors }) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
  },
  image: {
    flex: 1,
    marginVertical: spacing.huge,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.huge,
  },
  action: {
    borderRadius: rounded.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionPressed: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    transform: [{ scale: 0.95 }],
  },
  actionText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
}));
