import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { decode } from './src/kroki/coder';
import {
    buildDiagramState,
    createInitialDiagramState,
    defaultRenderUrl,
    diagramTypes,
    getValidFiletype,
    parseDiagramUrl,
} from './src/state';
import type { ExampleRecord } from './src/types';
import { useDebouncedValue } from './src/hooks/useDebouncedValue';
import { buildExamples } from './src/utils/examples';
import CodeEditor from './src/components/CodeEditor';
import PreviewPane from './src/components/PreviewPane';
import DocsDrawer from './src/components/DocsDrawer';
import DiagramTypePicker from './src/components/DiagramTypePicker';
import ExamplesModal from './src/components/ExamplesModal';
import { colors, radius, spacing } from './src/theme';

type Tab = 'code' | 'preview';

const BASE_URL = 'https://neolesk.pages.dev';

function App(): React.JSX.Element {
    const { width: windowWidth } = useWindowDimensions();
    const isTablet = windowWidth >= 768;

    const initialState = useMemo(() => {
        const hash = Platform.OS === 'web' ? window.location.hash : '';
        return createInitialDiagramState(BASE_URL, hash);
    }, []);
    const examples = useMemo(() => buildExamples(), []);

    const [diagramType, setDiagramType] = useState(initialState.diagramType);
    const [filetype, setFiletype] = useState(initialState.filetype);
    const [renderUrl] = useState(defaultRenderUrl);
    const [editorValue, setEditorValue] = useState(initialState.diagramText);
    const [previewText, setPreviewText] = useState(initialState.diagramText);
    const [draftsByDiagramType, setDraftsByDiagramType] = useState<Record<string, string>>({
        [initialState.diagramType]: initialState.diagramText,
    });
    const [activeTab, setActiveTab] = useState<Tab>('code');
    const [examplesOpen, setExamplesOpen] = useState(false);
    const [docsOpen, setDocsOpen] = useState(false);

    const debouncedEditorValue = useDebouncedValue(editorValue, 500);

    const previewState = useMemo(() => buildDiagramState({
        baseUrl: BASE_URL,
        diagramType,
        diagramText: previewText,
        filetype,
        renderUrl,
    }), [diagramType, filetype, previewText, renderUrl]);

    useEffect(() => {
        if (debouncedEditorValue === editorValue) {
            setPreviewText(debouncedEditorValue);
        }
    }, [debouncedEditorValue, editorValue]);

    // Sync URL hash with diagram state (web only)
    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const nextHash = `#${previewState.diagramHash}`;
        if (window.location.hash !== nextHash) {
            window.history.replaceState(null, '', nextHash);
        }
    }, [previewState.diagramHash]);

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const handleHashChange = () => {
            const parsed = parseDiagramUrl(window.location.hash);
            if (!parsed) return;
            setDiagramType(parsed.diagramType);
            setFiletype(parsed.filetype);
            setEditorValue(parsed.diagramText);
            setPreviewText(parsed.diagramText);
            updateDraft(parsed.diagramType, parsed.diagramText);
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const updateDraft = (type: string, text: string) => {
        setDraftsByDiagramType((current) =>
            current[type] === text ? current : { ...current, [type]: text }
        );
    };

    const handleDiagramTypeChange = useCallback((nextType: string) => {
        const nextText = draftsByDiagramType[nextType] || decode(diagramTypes[nextType].example);
        setDiagramType(nextType);
        setFiletype(getValidFiletype(nextType, filetype));
        setEditorValue(nextText);
        setPreviewText(nextText);
        updateDraft(nextType, nextText);
    }, [draftsByDiagramType, filetype]);

    const handleEditorChange = useCallback((value: string) => {
        setEditorValue(value);
        setDraftsByDiagramType((current) =>
            current[diagramType] === value ? current : { ...current, [diagramType]: value }
        );
    }, [diagramType]);

    const handleExampleImport = useCallback((example: ExampleRecord) => {
        setDiagramType(example.diagramType);
        setFiletype(getValidFiletype(example.diagramType, filetype));
        const exampleText = decode(example.example);
        setEditorValue(exampleText);
        setPreviewText(exampleText);
        updateDraft(example.diagramType, exampleText);
        setExamplesOpen(false);
    }, [filetype]);

    const showEditor = isTablet || activeTab === 'code';
    const showPreview = isTablet || activeTab === 'preview';

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.toolbar} />

            {/* Header */}
            <View style={styles.toolbar}>
                <Text style={styles.toolbarTitle}>Neolesk</Text>
                <DiagramTypePicker value={diagramType} onChange={handleDiagramTypeChange} />
                <View style={styles.toolbarSpacer} />
                <Pressable style={styles.iconButton} onPress={() => setExamplesOpen(true)}>
                    <Text style={styles.iconButtonText}>Examples</Text>
                </Pressable>
            </View>

            {/* Tab bar (phone only) */}
            {!isTablet && (
                <View style={styles.tabBar}>
                    <Pressable
                        style={[styles.tab, activeTab === 'code' && styles.tabActive]}
                        onPress={() => setActiveTab('code')}
                    >
                        <Text style={[styles.tabText, activeTab === 'code' && styles.tabTextActive]}>Code</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.tab, activeTab === 'preview' && styles.tabActive]}
                        onPress={() => setActiveTab('preview')}
                    >
                        <Text style={[styles.tabText, activeTab === 'preview' && styles.tabTextActive]}>Preview</Text>
                    </Pressable>
                </View>
            )}

            {/* Workspace */}
            <View style={[styles.workspace, isTablet && styles.workspaceTablet]}>
                {showEditor && (
                    <View style={[styles.pane, isTablet && styles.paneEditor]}>
                        <View style={styles.editorWithDrawer}>
                            <View style={styles.editorArea}>
                                <CodeEditor value={editorValue} language={previewState.language} onChange={handleEditorChange} />
                            </View>
                            <DocsDrawer
                                diagramType={diagramType}
                                examples={examples}
                                open={docsOpen}
                                onToggle={() => setDocsOpen(!docsOpen)}
                                onExampleImport={handleExampleImport}
                            />
                        </View>
                    </View>
                )}
                {showPreview && (
                    <View style={[styles.pane, isTablet && styles.panePreview]}>
                        <PreviewPane svgUrl={previewState.svgUrl} diagramType={diagramType} diagramText={previewText} />
                    </View>
                )}
            </View>

            {/* Modals */}
            <ExamplesModal
                open={examplesOpen}
                onClose={() => setExamplesOpen(false)}
                examples={examples}
                onImport={handleExampleImport}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
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
        marginRight: spacing.sm,
    },
    toolbarSpacer: {
        flex: 1,
    },
    iconButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
    },
    iconButtonText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    tabBar: {
        flexDirection: 'row',
        backgroundColor: colors.toolbar,
        borderBottomWidth: 1,
        borderBottomColor: colors.toolbarBorder,
    },
    tab: {
        flex: 1,
        paddingVertical: spacing.md,
        alignItems: 'center',
    },
    tabActive: {
        borderBottomWidth: 2,
        borderBottomColor: colors.accent,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    tabTextActive: {
        color: colors.accent,
        fontWeight: '600',
    },
    workspace: {
        flex: 1,
    },
    workspaceTablet: {
        flexDirection: 'row',
    },
    pane: {
        flex: 1,
    },
    paneEditor: {
        flex: 0.44,
        borderRightWidth: 1,
        borderRightColor: colors.divider,
    },
    panePreview: {
        flex: 0.56,
    },
    editorWithDrawer: {
        flex: 1,
    },
    editorArea: {
        flex: 1,
    },
});

export default App;
