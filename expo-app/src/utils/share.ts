import type { CopyScope, DiagramState } from '../types';
import { imageFiletypes } from './format';

export const getCopyText = (scope: CopyScope, state: DiagramState, currentText: string): string => {
    const markdownBody = imageFiletypes.has(state.filetype)
        ? `![Diagram](${state.exportUrl})`
        : `[Diagram ${state.filetype.toUpperCase()}](${state.exportUrl})`;

    switch (scope) {
        case 'image':
            return state.exportUrl;
        case 'edit':
            return state.editUrl;
        case 'markdown':
            return `${markdownBody}\n\n[Edit this diagram](${state.editUrl})\n`;
        case 'markdownsource':
            return `${markdownBody}\n\n<!--\n${currentText.split('-->').join('\\-\\-\\>')}\n-->\n\n[Edit this diagram](${state.editUrl})\n`;
        default:
            return '';
    }
};
