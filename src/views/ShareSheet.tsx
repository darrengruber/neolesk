import { Bot, Copy, FileDown, Link2, Printer, Share, UserRound, Users } from 'lucide-react';
import type { ExportFormat } from '../export/export';
import { Group, RowButton, iconProps } from '../ui/controls';
import { exportFormatNote, presenceText, type Presence } from '../ui/model';
import { Sheet } from '../ui/Sheet';

const formats: ExportFormat[] = ['svg', 'png', 'jpeg', 'pdf'];

export interface ShareSheetSession {
    available: boolean;
    active: boolean;
    presence: Presence;
    agentPresence: Presence;
    agentActivity: string | null;
    onStart: () => void;
    onCopyAgentUrl: () => void;
    onCopySessionLink: () => void;
}

export function ShareSheet({
    open,
    onClose,
    canShareLink,
    onCopySnapshot,
    onShareSnapshot,
    session,
    hasRenderServer,
    language,
    hasDiagram,
    madeOnDevice = false,
    onExport,
    onPrint,
}: {
    open: boolean;
    onClose: () => void;
    canShareLink: boolean;
    onCopySnapshot: () => void;
    onShareSnapshot: () => void;
    session: ShareSheetSession;
    hasRenderServer: boolean;
    /** The diagram language's name and the formats the render server can make for it. */
    language: { name: string; formats: readonly string[] };
    hasDiagram: boolean;
    /** This device can draw the diagram, so it makes PNG, JPEG and PDF itself (ADR 0021). */
    madeOnDevice?: boolean;
    onExport: (format: ExportFormat) => void;
    onPrint: () => void;
}) {
    const closeThen = (action: () => void) => () => {
        onClose();
        action();
    };

    return (
        <Sheet open={open} title="Share and Export" onClose={onClose} className="ShareSheet">
            <Group
                header="Snapshot Link"
                footer="A snapshot link holds this exact diagram in the URL. Later edits do not change it."
            >
                <RowButton title="Copy Snapshot Link" icon={<Link2 {...iconProps} />} onClick={closeThen(onCopySnapshot)} />
                {canShareLink && (
                    <RowButton title="Share Snapshot Link…" icon={<Share {...iconProps} />} onClick={closeThen(onShareSnapshot)} />
                )}
            </Group>

            {session.active ? (
                <Group
                    header="Live Session"
                    footer="Anyone with the session link can edit. Treat it like a password."
                >
                    <li className="Row">
                        <span className="RowIcon"><UserRound {...iconProps} /></span>
                        <span className="RowBody"><span className="RowTitle">You</span></span>
                        <span className="RowTrailing"><span className="PresenceDot" data-presence={session.presence} aria-hidden="true" />{presenceText('person', session.presence)}</span>
                    </li>
                    <li className="Row">
                        <span className="RowIcon"><Bot {...iconProps} /></span>
                        <span className="RowBody">
                            <span className="RowTitle">Agent</span>
                            {session.agentActivity && <span className="RowSubtitle">{session.agentActivity}</span>}
                        </span>
                        <span className="RowTrailing"><span className="PresenceDot" data-presence={session.agentPresence} aria-hidden="true" />{presenceText('agent', session.agentPresence)}</span>
                    </li>
                    <RowButton title="Copy Session Link" icon={<Link2 {...iconProps} />} onClick={closeThen(session.onCopySessionLink)} />
                    <RowButton title="Copy Agent URL" icon={<Copy {...iconProps} />} onClick={closeThen(session.onCopyAgentUrl)} />
                </Group>
            ) : (
                <Group
                    header="Live Session"
                    footer={session.available
                        ? 'Edit the same diagram with other people and MCP agents.'
                        : 'Sessions unavailable in this deployment.'}
                >
                    <RowButton
                        title="New Session"
                        icon={<Users {...iconProps} />}
                        disabled={!session.available}
                        onClick={closeThen(session.onStart)}
                    />
                </Group>
            )}

            <Group
                header="Export"
                footer={!hasDiagram
                    ? 'Export is available once the diagram renders.'
                    : madeOnDevice
                        ? 'Every format is made on this device. Nothing leaves it.'
                        : hasRenderServer
                            ? 'SVG is made on this device. This diagram has HTML labels or linked files, so the render server makes the other formats.'
                            : 'SVG is made on this device. The other formats need a render server for this diagram.'}
            >
                {formats.map((format) => {
                    const note = exportFormatNote(format, hasRenderServer, language, madeOnDevice);
                    return (
                        <RowButton
                            key={format}
                            title={format.toUpperCase()}
                            icon={<FileDown {...iconProps} />}
                            trailing={note || undefined}
                            disabled={Boolean(note) || !hasDiagram}
                            onClick={closeThen(() => onExport(format))}
                        />
                    );
                })}
                <RowButton
                    title="Print…"
                    icon={<Printer {...iconProps} />}
                    disabled={!hasDiagram}
                    onClick={closeThen(onPrint)}
                />
            </Group>
        </Sheet>
    );
}
