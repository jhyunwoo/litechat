import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/** 렌더링 오류가 빈 화면으로 끝나지 않도록 최소 복구 화면을 제공한다. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 원문 오류/사용자 데이터는 프로덕션 로그로 보내지 않는다.
    console.error('A fatal UI error was caught');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.screen} accessibilityRole="alert">
        <Text style={styles.title}>화면을 불러오지 못했어요</Text>
        <Text style={styles.body}>잠시 후 다시 시도해 주세요.</Text>
        <Pressable
          style={styles.button}
          onPress={() => this.setState({ failed: false })}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: { fontSize: 20, fontWeight: '600', color: '#1D1D1F' },
  body: { marginTop: 8, fontSize: 15, color: '#7A7A7A' },
  button: {
    marginTop: 24,
    minHeight: 48,
    minWidth: 140,
    borderRadius: 999,
    backgroundColor: '#0066CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16 },
});
