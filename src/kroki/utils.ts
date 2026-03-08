export const createKrokiUrl = (renderUrl: string, diagramType: string, filetype: string, encodedText: string): string =>
    [renderUrl.replace(/\/*$/, ''), diagramType, filetype, encodedText].join('/');
