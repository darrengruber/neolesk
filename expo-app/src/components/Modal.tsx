import React, { type ReactNode } from 'react';
import {
    Modal as RNModal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { colors, radius, spacing } from '../theme';

interface ModalProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    actions?: ReactNode;
    headerExtras?: ReactNode;
}

const Modal = ({ open, title, onClose, children, actions, headerExtras }: ModalProps): React.JSX.Element | null => {
    if (!open) return null;

    return (
        <RNModal
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.surface} onPress={() => {}}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>{title}</Text>
                        {headerExtras}
                    </View>
                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                        {children}
                    </ScrollView>
                    <View style={styles.footer}>
                        {actions}
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Text style={styles.closeButtonText}>Close</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </RNModal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    surface: {
        backgroundColor: colors.surface,
        borderRadius: radius.xl,
        width: '100%',
        maxHeight: '85%',
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
        flex: 1,
    },
    body: {
        flexShrink: 1,
    },
    bodyContent: {
        padding: spacing.xl,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.lg,
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    closeButton: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
    },
    closeButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
});

export default Modal;
