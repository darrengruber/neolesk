import type { CopyScope, DiagramState } from '../types';
import { imageFiletypes } from './format';

export const getCopyText = (scope: CopyScope, previewState: DiagramState, currentText: string): string => {
    const markdownBody = imageFiletypes.has(previewState.filetype)
        ? `![Diagram](${previewState.diagramUrl})`
        : `[Diagram ${previewState.filetype.toUpperCase()}](${previewState.diagramUrl})`;

    switch (scope) {
        case 'image':
            return previewState.diagramUrl;
        case 'edit':
            return previewState.diagramEditUrl;
        case 'markdown':
            return `${markdownBody}\n\n[Edit this diagram](${previewState.diagramEditUrl})\n`;
        case 'markdownsource':
            return `${markdownBody}\n\n<!--\n${currentText.split('-->').join('\\-\\-\\>')}\n-->\n\n[Edit this diagram](${previewState.diagramEditUrl})\n`;
        default:
            return '';
    }
};
