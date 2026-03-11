import React, { useMemo, useState } from 'react';
import {
    FlatList,
    Image,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import Modal from './Modal';
import { decode } from '../kroki/coder';
import { filterExamples } from '../utils/examples';
import type { ExampleRecord } from '../types';
import { colors, radius, spacing } from '../theme';

interface ExamplesModalProps {
    open: boolean;
    onClose: () => void;
    examples: ExampleRecord[];
    onImport: (example: ExampleRecord) => void;
}

const ExamplesModal = ({ open, onClose, examples, onImport }: ExamplesModalProps): React.JSX.Element | null => {
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const filtered = useMemo(() => filterExamples(examples, search), [examples, search]);
    const selected = selectedId !== null ? examples.find((e) => e.id === selectedId) : null;

    const handleBack = () => setSelectedId(null);
    const handleClose = () => {
        setSelectedId(null);
        setSearch('');
        onClose();
    };

    if (selected) {
        return (
            <Modal
                open={open}
                title={selected.title}
                onClose={handleClose}
                actions={
                    <>
                        <Pressable style={styles.actionButton} onPress={handleBack}>
                            <Text style={styles.actionButtonText}>Back</Text>
                        </Pressable>
                        <Pressable style={styles.importButton} onPress={() => { onImport(selected); handleClose(); }}>
                            <Text style={styles.importButtonText}>Import</Text>
                        </Pressable>
                    </>
                }
            >
                <View style={styles.detailContainer}>
                    <Text style={styles.detailDescription}>{selected.description}</Text>
                    <Image source={{ uri: selected.url }} style={styles.detailImage} resizeMode="contain" />
                    <View style={styles.codeBlock}>
                        <Text style={styles.codeText}>{decode(selected.example)}</Text>
                    </View>
                </View>
            </Modal>
        );
    }

    return (
        <Modal
            open={open}
            title="Examples"
            onClose={handleClose}
            headerExtras={
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search..."
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
            }
        >
            <FlatList
                data={filtered}
                keyExtractor={(item) => String(item.id)}
                scrollEnabled={false}
                renderItem={({ item }) => (
                    <Pressable style={styles.card} onPress={() => setSelectedId(item.id)}>
                        <Image source={{ uri: item.url }} style={styles.cardImage} resizeMode="contain" />
                        <View style={styles.cardBody}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
                        </View>
                        <View style={styles.cardActions}>
                            <Pressable style={styles.importButton} onPress={() => { onImport(item); handleClose(); }}>
                                <Text style={styles.importButtonText}>Import</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                )}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    searchInput: {
        backgroundColor: colors.codeBackground,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        fontSize: 14,
        color: colors.text,
        minWidth: 120,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        marginBottom: spacing.sm,
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        gap: spacing.md,
    },
    cardImage: {
        width: 64,
        height: 48,
        borderRadius: radius.sm,
        backgroundColor: colors.codeBackground,
    },
    cardBody: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    cardDescription: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    cardActions: {
        gap: spacing.xs,
    },
    actionButton: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    importButton: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.accent,
    },
    importButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
    },
    detailContainer: {
        gap: spacing.lg,
    },
    detailDescription: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    detailImage: {
        width: '100%',
        height: 200,
        borderRadius: radius.md,
        backgroundColor: colors.codeBackground,
    },
    codeBlock: {
        backgroundColor: colors.codeBackground,
        borderRadius: radius.md,
        padding: spacing.lg,
    },
    codeText: {
        fontFamily: 'monospace',
        fontSize: 12,
        color: colors.text,
    },
});

export default ExamplesModal;
