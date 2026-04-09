const diagramMetadata: Record<string, { language?: string; filetypes: string[] }> = {
    actdiag: { filetypes: ['svg', 'png', 'pdf'] },
    blockdiag: { filetypes: ['svg', 'png', 'pdf'] },
    bpmn: { language: 'xml', filetypes: ['svg'] },
    bytefield: { filetypes: ['svg'] },
    c4plantuml: { filetypes: ['svg', 'png', 'pdf'] },
    d2: { filetypes: ['svg'] },
    dbml: { language: 'sql', filetypes: ['svg'] },
    ditaa: { filetypes: ['svg', 'png'] },
    erd: { filetypes: ['svg', 'png', 'pdf', 'jpeg'] },
    excalidraw: { language: 'json', filetypes: ['svg'] },
    graphviz: { filetypes: ['svg', 'png', 'pdf', 'jpeg'] },
    mermaid: { language: 'markdown', filetypes: ['svg', 'png'] },
    nomnoml: { filetypes: ['svg'] },
    nwdiag: { filetypes: ['svg', 'png', 'pdf'] },
    packetdiag: { filetypes: ['svg', 'png', 'pdf'] },
    pikchr: { filetypes: ['svg'] },
    plantuml: { filetypes: ['svg', 'png', 'pdf'] },
    rackdiag: { filetypes: ['svg', 'png', 'pdf'] },
    seqdiag: { filetypes: ['svg', 'png', 'pdf'] },
    structurizr: { filetypes: ['svg', 'png', 'pdf'] },
    svgbob: { language: 'markdown', filetypes: ['svg'] },
    symbolator: { language: 'systemverilog', filetypes: ['svg', 'png'] },
    tikz: { language: 'markdown', filetypes: ['svg', 'png', 'pdf', 'jpeg'] },
    umlet: { filetypes: ['svg', 'png', 'jpeg'] },
    vega: { language: 'json', filetypes: ['svg', 'png', 'pdf'] },
    vegalite: { language: 'json', filetypes: ['svg', 'png', 'pdf'] },
    wavedrom: { language: 'json', filetypes: ['svg'] },
    wireviz: { language: 'yaml', filetypes: ['svg', 'png'] },
};

export const defaultFiletype = 'svg';

export const getDiagramMetadata = (diagramType: string): { language?: string; filetypes?: string[] } => diagramMetadata[diagramType] || {};

export const getDiagramFiletypes = (diagramType: string): string[] => {
    const filetypes = getDiagramMetadata(diagramType).filetypes;
    return filetypes && filetypes.length > 0 ? filetypes : [defaultFiletype];
};

export default diagramMetadata;
