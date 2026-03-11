import { StyleSheet } from 'react-native';

export const colors = {
    background: '#f8fafc',
    surface: '#ffffff',
    surfaceBorder: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    accent: '#2563eb',
    accentLight: '#dbeafe',
    accentDark: '#1d4ed8',
    error: '#ef4444',
    divider: '#e2e8f0',
    toolbar: '#ffffff',
    toolbarBorder: '#e2e8f0',
    codeBackground: '#f1f5f9',
    overlay: 'rgba(0,0,0,0.4)',
};

export const fonts = {
    sans: undefined, // system default
    mono: 'monospace' as const,
};

export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
};

export const radius = {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
};

export const commonStyles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: colors.background,
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.toolbar,
        borderBottomWidth: 1,
        borderBottomColor: colors.toolbarBorder,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        gap: spacing.sm,
    },
    toolbarTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
        letterSpacing: -0.3,
    },
    button: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
    },
    buttonActive: {
        backgroundColor: colors.accentLight,
        borderColor: colors.accent,
    },
    buttonText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    buttonTextActive: {
        color: colors.accent,
    },
    primaryButton: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontWeight: '600',
    },
});
