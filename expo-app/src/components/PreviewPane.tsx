import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    LayoutChangeEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSvgFetch } from '../hooks/useSvgFetch';
import { exportDiagram, type ExportFormat } from '../utils/svgExport';
import Modal from './Modal';
import { colors, radius, spacing } from '../theme';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

const EXPORT_FORMATS: { format: ExportFormat; label: string; description: string }[] = [
    { format: 'svg', label: 'SVG', description: 'Vector — perfect quality at any size' },
    { format: 'png', label: 'PNG', description: 'Raster — transparent background, high DPI' },
    { format: 'jpeg', label: 'JPEG', description: 'Raster — smaller file, white background' },
    { format: 'pdf', label: 'PDF', description: 'Document — print-ready' },
];

interface PreviewPaneProps {
    svgUrl: string;
    diagramType: string;
    diagramText: string;
}

const PreviewPane = ({ svgUrl, diagramType, diagramText }: PreviewPaneProps): React.JSX.Element => {
    const svg = useSvgFetch({ svgUrl, diagramType, diagramText });
    const [viewportSize, setViewportSize] = useState({ width: 300, height: 400 });
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState<ExportFormat | null>(null);

    // Ref to the view that renders the diagram image, for native view-shot capture
    const captureViewRef = useRef<View>(null);

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const fitToViewport = useCallback(() => {
        if (!svg.dimensions) return;
        const padding = 32;
        const scaleX = (viewportSize.width - padding) / svg.dimensions.width;
        const scaleY = (viewportSize.height - padding) / svg.dimensions.height;
        const fitScale = Math.min(scaleX, scaleY, 1);

        scale.value = withTiming(fitScale, { duration: 200 });
        savedScale.value = fitScale;
        translateX.value = withTiming(0, { duration: 200 });
        translateY.value = withTiming(0, { duration: 200 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
    }, [svg.dimensions, viewportSize, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

    useEffect(() => {
        if (svg.dimensions && !svg.loading) {
            fitToViewport();
        }
    }, [svg.dimensions, svg.loading, fitToViewport]);

    const pinchGesture = Gesture.Pinch()
        .onStart(() => { savedScale.value = scale.value; })
        .onUpdate((e) => {
            scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
        })
        .onEnd(() => { savedScale.value = scale.value; });

    const panGesture = Gesture.Pan()
        .onStart(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        })
        .onUpdate((e) => {
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    const composed = Gesture.Simultaneous(pinchGesture, panGesture);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    const handleLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setViewportSize({ width, height });
    };

    const handleZoomIn = () => {
        const next = Math.min(MAX_SCALE, scale.value * 1.3);
        scale.value = withTiming(next, { duration: 150 });
        savedScale.value = next;
    };

    const handleZoomOut = () => {
        const next = Math.max(MIN_SCALE, scale.value / 1.3);
        scale.value = withTiming(next, { duration: 150 });
        savedScale.value = next;
    };

    const handleExport = useCallback(async (format: ExportFormat) => {
        if (!svg.svgText || exporting) return;
        setExporting(format);
        try {
            await exportDiagram({
                svgText: svg.svgText,
                diagramType,
                format,
                captureViewRef,
            });
        } catch (err) {
            console.warn('Export failed:', err);
        } finally {
            setExporting(null);
            setExportOpen(false);
        }
    }, [svg.svgText, diagramType, exporting]);

    const canExport = !svg.loading && !svg.error && !!svg.svgText;

    // On web, use blob URL for reliable SVG rendering; on native, use the remote URL
    const imageSource = Platform.OS === 'web' && svg.blobUrl
        ? { uri: svg.blobUrl }
        : { uri: svg.svgUrl };

    const imageStyle = svg.dimensions
        ? { width: svg.dimensions.width, height: svg.dimensions.height }
        : { width: 400, height: 300 };

    return (
        <View style={styles.container}>
            <View style={styles.toolbar}>
                <Pressable style={styles.zoomButton} onPress={handleZoomOut}>
                    <Text style={styles.zoomButtonText}>-</Text>
                </Pressable>
                <Pressable style={styles.zoomButton} onPress={handleZoomIn}>
                    <Text style={styles.zoomButtonText}>+</Text>
                </Pressable>
                <Pressable style={styles.fitButton} onPress={fitToViewport}>
                    <Text style={styles.zoomButtonText}>Fit</Text>
                </Pressable>
                <View style={styles.toolbarSpacer} />
                <Pressable
                    style={[styles.exportButton, !canExport && styles.exportButtonDisabled]}
                    onPress={() => canExport && setExportOpen(true)}
                    disabled={!canExport}
                >
                    <Text style={[styles.exportButtonText, !canExport && styles.exportButtonTextDisabled]}>
                        Export
                    </Text>
                </Pressable>
            </View>

            <GestureHandlerRootView style={styles.viewport} onLayout={handleLayout}>
                <GestureDetector gesture={composed}>
                    <Animated.View style={[styles.canvas, animatedStyle]}>
                        {svg.error ? (
                            <Text style={styles.errorText}>Failed to load diagram</Text>
                        ) : svg.loading ? (
                            <ActivityIndicator size="large" color={colors.accent} />
                        ) : (
                            <View ref={captureViewRef} collapsable={false}>
                                <Image
                                    source={imageSource}
                                    style={imageStyle}
                                    resizeMode="contain"
                                />
                            </View>
                        )}
                    </Animated.View>
                </GestureDetector>
            </GestureHandlerRootView>

            {/* Export modal */}
            <Modal open={exportOpen} title="Export Diagram" onClose={() => setExportOpen(false)}>
                <View style={styles.exportList}>
                    {EXPORT_FORMATS.map(({ format, label, description }) => (
                        <Pressable
                            key={format}
                            style={styles.exportRow}
                            onPress={() => handleExport(format)}
                            disabled={!!exporting}
                        >
                            <View style={styles.exportRowContent}>
                                <Text style={styles.exportLabel}>{label}</Text>
                                <Text style={styles.exportDescription}>{description}</Text>
                            </View>
                            {exporting === format ? (
                                <ActivityIndicator size="small" color={colors.accent} />
                            ) : (
                                <Text style={styles.exportAction}>
                                    {Platform.OS === 'web' ? 'Download' : 'Share'}
                                </Text>
                            )}
                        </Pressable>
                    ))}
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        backgroundColor: colors.surface,
    },
    toolbarSpacer: {
        flex: 1,
    },
    zoomButton: {
        width: 36,
        height: 32,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fitButton: {
        height: 32,
        paddingHorizontal: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        alignItems: 'center',
        justifyContent: 'center',
    },
    zoomButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    exportButton: {
        height: 32,
        paddingHorizontal: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
    },
    exportButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
    },
    exportButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#ffffff',
    },
    exportButtonTextDisabled: {
        color: colors.textMuted,
    },
    exportList: {
        gap: spacing.sm,
    },
    exportRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.background,
    },
    exportRowContent: {
        flex: 1,
        marginRight: spacing.md,
    },
    exportLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    exportDescription: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    exportAction: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.accent,
    },
    viewport: {
        flex: 1,
        overflow: 'hidden',
    },
    canvas: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorText: {
        color: colors.error,
        fontSize: 14,
    },
});

export default PreviewPane;
