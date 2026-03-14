import React, { useCallback, useMemo, useState } from 'react';
import {
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';
import Modal from './Modal';
import { decode } from '../kroki/coder';
import { filterExamples } from '../utils/examples';
import type { ExampleRecord } from '../types';
import CachedSvgImage from './CachedSvgImage';
import { colors, radius, spacing } from '../theme';

interface ExamplesModalProps {
    open: boolean;
    onClose: () => void;
    examples: ExampleRecord[];
    onImport: (example: ExampleRecord) => void;
}

const CARD_MIN_WIDTH = 320;

const ExampleCard = React.memo(({ item, onSelect, onImport }: {
    item: ExampleRecord;
    onSelect: (id: number) => void;
    onImport: (item: ExampleRecord) => void;
}) => {
    return (
        <View style={styles.card}>
            <Pressable onPress={() => onSelect(item.id)} style={styles.cardPreview}>
                <CachedSvgImage
                    url={item.url}
                    cacheUrl={item.cacheUrl}
                    style={styles.cardImage}
                />
            </Pressable>
            <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
            </View>
            <View style={styles.cardFooter}>
                <Pressable style={styles.viewButton} onPress={() => onSelect(item.id)}>
                    <Text style={styles.viewButtonText}>View</Text>
                </Pressable>
                <Pressable style={styles.importButton} onPress={() => onImport(item)}>
                    <Text style={styles.importButtonText}>Import</Text>
                </Pressable>
            </View>
        </View>
    );
});

const ExamplesModal = ({ open, onClose, examples, onImport }: ExamplesModalProps): React.JSX.Element | null => {
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { width: windowWidth } = useWindowDimensions();

    const numColumns = Math.max(1, Math.floor((windowWidth - spacing.xl * 2) / CARD_MIN_WIDTH));

    const filtered = useMemo(() => filterExamples(examples, search), [examples, search]);
    const selected = selectedId !== null ? examples.find((e) => e.id === selectedId) : null;

    const handleBack = useCallback(() => setSelectedId(null), []);
    const handleClose = useCallback(() => {
        setSelectedId(null);
        setSearch('');
        onClose();
    }, [onClose]);

    const handleImport = useCallback((item: ExampleRecord) => {
        onImport(item);
        handleClose();
    }, [onImport, handleClose]);

    const handleSelect = useCallback((id: number) => setSelectedId(id), []);

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
                        <Pressable style={styles.importButton} onPress={() => handleImport(selected)}>
                            <Text style={styles.importButtonText}>Import</Text>
                        </Pressable>
                    </>
                }
            >
                <View style={styles.detailContainer}>
                    <Text style={styles.detailDescription}>{selected.description}</Text>
                    <View style={styles.detailImageContainer}>
                        <CachedSvgImage
                            url={selected.url}
                            cacheUrl={selected.cacheUrl}
                            style={styles.detailImage}
                        />
                    </View>
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
                numColumns={numColumns}
                key={`grid-${numColumns}`}
                columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
                renderItem={({ item }) => (
                    <ExampleCard
                        item={item}
                        onSelect={handleSelect}
                        onImport={handleImport}
                    />
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
    row: {
        gap: spacing.md,
    },
    card: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        marginBottom: spacing.md,
        overflow: 'hidden',
    },
    cardPreview: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.sm,
    },
    cardImage: {
        width: '100%',
        height: '100%',
    },
    cardBody: {
        padding: spacing.md,
        gap: 2,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    cardDescription: {
        fontSize: 12,
        color: colors.textSecondary,
        lineHeight: 16,
    },
    cardFooter: {
        flexDirection: 'row',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.md,
    },
    viewButton: {
        flex: 1,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        alignItems: 'center',
    },
    viewButtonText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    importButton: {
        flex: 1,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.sm,
        backgroundColor: colors.accent,
        alignItems: 'center',
    },
    importButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#ffffff',
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
    detailContainer: {
        gap: spacing.lg,
    },
    detailDescription: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    detailImageContainer: {
        backgroundColor: '#ffffff',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.divider,
        padding: spacing.md,
        height: 280,
    },
    detailImage: {
        width: '100%',
        height: '100%',
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
