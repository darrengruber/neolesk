interface OutputFormatGroupProps {
    filetype: string;
    filetypes: string[];
    onChange: (filetype: string) => void;
}

const formatLabel = (filetype: string): string => filetype.toUpperCase();

function OutputFormatGroup({ filetype, filetypes, onChange }: OutputFormatGroupProps): JSX.Element {
    return (
        <div className="OutputFormatGroup" role="group" aria-label="Output format">
            {filetypes.map((supportedFiletype) => (
                <button
                    key={supportedFiletype}
                    type="button"
                    className={`OutputFormatButton${filetype === supportedFiletype ? ' active' : ''}`}
                    onClick={() => onChange(supportedFiletype)}
                >
                    {formatLabel(supportedFiletype)}
                </button>
            ))}
        </div>
    );
}

export default OutputFormatGroup;
