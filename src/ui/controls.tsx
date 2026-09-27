import type { ReactNode } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';

/** Lucide strokes restyled toward the SF Symbols regular weight (ADR 0003). */
export const iconProps = { 'aria-hidden': true, strokeWidth: 1.75 } as const;

export function Spinner({ label }: { label: string }) {
    return (
        <div className="ActivityState" role="status">
            <span className="Spinner" aria-hidden="true">
                {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
            </span>
            <span>{label}</span>
        </div>
    );
}

export function SearchField({ value, onChange, label, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder: string;
}) {
    return (
        <div className="SearchField">
            <Search {...iconProps} />
            <input
                type="search"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={label}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
            />
        </div>
    );
}

export function Group({ header, footer, children, count }: {
    header?: string;
    footer?: ReactNode;
    count?: number;
    children: ReactNode;
}) {
    return (
        <section className="Group" aria-label={header}>
            {header && (
                <h3 className="GroupHeader">
                    {header}{typeof count === 'number' && <span className="GroupCount"> {count}</span>}
                </h3>
            )}
            <ul className="GroupList">{children}</ul>
            {footer && <p className="GroupFooter">{footer}</p>}
        </section>
    );
}

/** A tappable row. The trailing chevron marks a row that moves somewhere else. */
export function RowButton({ title, subtitle, trailing, icon, chevron = false, disabled = false, onClick }: {
    title: string;
    subtitle?: string;
    trailing?: ReactNode;
    icon?: ReactNode;
    chevron?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <li>
            <button
                type="button"
                className="Row RowButton"
                disabled={disabled}
                onClick={onClick}
            >
                {icon && <span className="RowIcon">{icon}</span>}
                <span className="RowBody">
                    <span className="RowTitle">{title}</span>
                    {subtitle && <span className="RowSubtitle">{subtitle}</span>}
                </span>
                {trailing && <span className="RowTrailing">{trailing}</span>}
                {chevron && <ChevronRight className="RowChevron" {...iconProps} />}
            </button>
        </li>
    );
}

/** A Settings-style choice: a radio row with a trailing checkmark. */
export function OptionRow({ name, value, checked, label, detail, disabled = false, onSelect }: {
    name: string;
    value: string;
    checked: boolean;
    label: string;
    detail?: string;
    disabled?: boolean;
    onSelect: (value: string) => void;
}) {
    return (
        <li>
            <label className="Row OptionRow" data-disabled={disabled || undefined}>
                <input
                    type="radio"
                    name={name}
                    value={value}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onSelect(value)}
                />
                <span className="RowBody">
                    <span className="RowTitle">{label}</span>
                    {detail && <span className="RowSubtitle">{detail}</span>}
                </span>
                <Check className="OptionCheck" {...iconProps} />
            </label>
        </li>
    );
}

export function SwitchRow({ label, checked, onChange }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <li>
            <label className="Row SwitchRow">
                <span className="RowBody"><span className="RowTitle">{label}</span></span>
                <input
                    type="checkbox"
                    role="switch"
                    className="Switch"
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                />
            </label>
        </li>
    );
}

export function SegmentedControl<T extends string>({ name, label, value, options, onChange }: {
    name: string;
    label: string;
    value: T;
    options: Array<{ value: T; label: string }>;
    onChange: (value: T) => void;
}) {
    return (
        <div className="SegmentedControl" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <label key={option.value} className="Segment">
                    <input
                        type="radio"
                        name={name}
                        value={option.value}
                        checked={option.value === value}
                        onChange={() => onChange(option.value)}
                    />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    );
}
