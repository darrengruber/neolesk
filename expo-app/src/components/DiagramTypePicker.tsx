import React, { useState } from 'react';
import {
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import Modal from './Modal';
import { diagramTypes } from '../state';
import { colors, radius, spacing } from '../theme';

interface DiagramTypePickerProps {
    value: string;
    onChange: (diagramType: string) => void;
}

const diagramTypeEntries = Object.entries(diagramTypes);

const DiagramTypePicker = ({ value, onChange }: DiagramTypePickerProps): React.JSX.Element => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const currentName = diagramTypes[value]?.name || value;

    const filtered = search
        ? diagramTypeEntries.filter(([key, info]) =>
            key.toLowerCase().includes(search.toLowerCase()) ||
            info.name.toLowerCase().includes(search.toLowerCase())
        )
        : diagramTypeEntries;

    const handleSelect = (key: string) => {
        onChange(key);
        setOpen(false);
        setSearch('');
    };

    return (
        <>
            <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
                <Text style={styles.triggerLabel}>Type</Text>
                <Text style={styles.triggerValue} numberOfLines={1}>{currentName}</Text>
                <Text style={styles.triggerChevron}>▾</Text>
            </Pressable>

            <Modal
                open={open}
                title="Diagram Type"
                onClose={() => { setOpen(false); setSearch(''); }}
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
                    keyExtractor={([key]) => key}
                    scrollEnabled={false}
                    renderItem={({ item: [key, info] }) => (
                        <Pressable
                            style={[styles.item, key === value && styles.itemActive]}
                            onPress={() => handleSelect(key)}
                        >
                            <Text style={[styles.itemText, key === value && styles.itemTextActive]}>
                                {info.name}
                            </Text>
                        </Pressable>
                    )}
                />
            </Modal>
        </>
    );
};

const styles = StyleSheet.create({
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        flex: 1,
    },
    triggerLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    triggerValue: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
        flex: 1,
    },
    triggerChevron: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    searchInput: {
        backgroundColor: colors.codeBackground,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        fontSize: 14,
        color: colors.text,
        minWidth: 120,
    },
    item: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.sm,
    },
    itemActive: {
        backgroundColor: colors.accentLight,
    },
    itemText: {
        fontSize: 15,
        color: colors.text,
    },
    itemTextActive: {
        color: colors.accent,
        fontWeight: '600',
    },
});

export default DiagramTypePicker;
