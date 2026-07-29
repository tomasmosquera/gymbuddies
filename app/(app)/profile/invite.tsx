import { useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors, spacing, typography } from '@/constants/theme';

// Deliberately just the code, not the gymbuddies://join-group deep link:
// WhatsApp only auto-linkifies http(s) URLs, so a custom-scheme link would
// show as inert, confusing plain text here. The deep link still earns its
// keep elsewhere — the QR code below encodes it, and scanning never depends
// on WhatsApp's link detection.
function inviteMessage(groupName: string, code: string): string {
  return `Únete a mi grupo "${groupName}" en Gym Buddies. Abre la app y toca "Unirme con un código" con este código: ${code}`;
}

export default function InviteScreen() {
  const { group, isLoading } = useActiveGroup();
  const [codeCopied, setCodeCopied] = useState(false);
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false);

  if (isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(group.invite_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleSendWhatsapp = async () => {
    setIsSendingWhatsapp(true);
    const message = inviteMessage(group.name, group.invite_code);
    try {
      // Deliberately skip Linking.canOpenURL first: on iOS it only reports
      // truthfully for schemes listed in Info.plist's LSApplicationQueriesSchemes
      // (a native-config change that would need a new build), and always
      // returns false otherwise — so it can't be trusted here. Just try
      // opening WhatsApp directly; openURL itself rejects if it's not
      // installed, which the catch below turns into the share-sheet fallback.
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`);
    } catch {
      await Share.share({ message });
    } finally {
      setIsSendingWhatsapp(false);
    }
  };

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Código de invitación</Text>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.inviteCode}>{group.invite_code}</Text>
        <Button label={codeCopied ? 'Copiado ✓' : 'Copiar código'} variant="secondary" onPress={handleCopyCode} />
        <Button label="Enviar por WhatsApp" onPress={handleSendWhatsapp} loading={isSendingWhatsapp} />
      </Card>

      <Card style={styles.qrCard}>
        <Text style={styles.cardTitle}>O que escaneen este código</Text>
        <View style={styles.qrWrap}>
          <QRCode value={`gymbuddies://join-group?code=${group.invite_code}`} size={200} />
        </View>
        <Text style={styles.qrHint}>
          Funciona con la cámara del celular o con &quot;Escanear código QR&quot; dentro de Gym Buddies, si la persona ya
          tiene la app instalada.
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  card: { gap: spacing.sm },
  cardTitle: { color: colors.textMuted, fontSize: 13 },
  groupName: { ...typography.heading, color: colors.text },
  inviteCode: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: 2, marginVertical: spacing.xs },
  qrCard: { gap: spacing.sm, alignItems: 'center' },
  qrWrap: { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: 12 },
  qrHint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
