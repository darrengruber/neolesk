import React, { useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import type { CopyScope, DiagramState } from '../types';
import { getCopyText } from '../utils/share';
import { copyText } from '../utils/clipboard';
import { colors, radius, spacing } from '../theme';

const copyScopes: { scope: CopyScope; label: string }[] = [
    { scope: 'image', label: 'Render URL' },
    { scope: 'edit', label: 'Edit URL' },
    { scope: 'markdown', label: 'Markdown snippet' },
    { scope: 'markdownsource', label: 'Markdown with source' },
];

interface ShareSheetProps {
    previewState: DiagramState;
    editorValue: string;
}

const ShareSheet = ({ previewState, editorValue }: ShareSheetProps): React.JSX.Element => {
    const [copiedScope, setCopiedScope] = useState<CopyScope | null>(null);

    const handleCopy = async (scope: CopyScope) => {
        const text = getCopyText(scope, previewState, editorValue);
        await copyText(text);
        setCopiedScope(scope);
        setTimeout(() => setCopiedScope(null), 1200);
    };

    const handleShare = async () => {
        const text = getCopyText('edit', previewState, editorValue);
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(text, { dialogTitle: 'Share diagram' }).catch(() => {});
        }
    };

    return (
        <View style={styles.container}>
            {copyScopes.map(({ scope, label }) => (
                <View key={scope} style={styles.row}>
                    <Text style={styles.label}>{label}</Text>
                    <Pressable
                        style={[styles.copyButton, copiedScope === scope && styles.copyButtonCopied]}
                        onPress={() => handleCopy(scope)}
                    >
                        <Text style={[styles.copyButtonText, copiedScope === scope && styles.copyButtonTextCopied]}>
                            {copiedScope === scope ? 'Copied' : 'Copy'}
                        </Text>
                    </Pressable>
                </View>
            ))}
            <Pressable style={styles.shareButton} onPress={handleShare}>
                <Text style={styles.shareButtonText}>Share</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        gap: spacing.sm,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
    },
    label: {
        fontSize: 14,
        color: colors.text,
        flex: 1,
    },
    copyButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
    },
    copyButtonCopied: {
        backgroundColor: colors.accentLight,
        borderColor: colors.accent,
    },
    copyButtonText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    copyButtonTextCopied: {
        color: colors.accent,
    },
    shareButton: {
        backgroundColor: colors.accent,
        borderRadius: radius.sm,
        paddingVertical: spacing.md,
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    shareButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
});

export default ShareSheet;
