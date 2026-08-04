import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/constants/theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches otherwise-uncaught render errors anywhere below it — the classic
 * cause in this app is a stale JS bundle (someone on an old native build)
 * calling something the current backend no longer matches, which used to
 * surface as a raw crash screen. Swaps that for a plain-language explanation
 * plus a retry, since React only supports error boundaries as class
 * components — there's no hook equivalent for this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.body}>
            Ocurrió un error inesperado. Puede deberse a que tu versión de la app está desactualizada — revisa si
            hay una actualización disponible en la App Store o Play Store. Si el problema sigue, intenta de nuevo
            más tarde.
          </Text>
          <Button label="Reintentar" onPress={this.handleRetry} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  body: { color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
