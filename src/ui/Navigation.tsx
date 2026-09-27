import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Code2, Columns2, Eye, Library, Settings } from 'lucide-react';
import { iconProps } from './controls';
import type { Panel, TabDefinition, TabIcon } from './model';

/**
 * A 44 pt navigation bar: leading, centre and trailing slots. It is clear at
 * rest and takes the bar material once content scrolls underneath it.
 */
export function NavigationBar({ leading, center, trailing, scrolled = true }: {
    leading?: ReactNode;
    center?: ReactNode;
    trailing?: ReactNode;
    scrolled?: boolean;
}) {
    return (
        <header className="NavBar" data-scrolled={scrolled || undefined}>
            <div className="NavBarSide">{leading}</div>
            <div className="NavBarCenter">{center}</div>
            <div className="NavBarSide NavBarTrailing">{trailing}</div>
        </header>
    );
}

/**
 * A page with a large title that hands over to the inline bar title once it
 * scrolls away, as iOS navigation bars do.
 */
export function LargeTitlePage({ title, titleId, leading, trailing, children, animate, focusTitle = false }: {
    title: string;
    titleId: string;
    leading?: ReactNode;
    trailing?: ReactNode;
    children: ReactNode;
    /** Structural motion: a pushed page slides in, a popped one settles back. */
    animate?: 'push' | 'pop';
    /** Move focus to the title, as iOS does for VoiceOver after a push. */
    focusTitle?: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const root = scrollRef.current;
        const heading = titleRef.current;
        if (!root || !heading || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(
            ([entry]) => setScrolled(!entry.isIntersecting),
            { root, threshold: 0, rootMargin: '-8px 0px 0px 0px' },
        );
        observer.observe(heading);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (focusTitle) titleRef.current?.focus({ preventScroll: true });
    }, [focusTitle]);

    return (
        <div className="LargeTitlePage" data-animate={animate}>
            <NavigationBar
                scrolled={scrolled}
                leading={leading}
                center={<span className="NavBarTitle" aria-hidden="true">{title}</span>}
                trailing={trailing}
            />
            <div className="PageScroll" ref={scrollRef}>
                <h1 id={titleId} ref={titleRef} className="LargeTitle" tabIndex={-1}>{title}</h1>
                {children}
            </div>
        </div>
    );
}

const tabIcons: Record<TabIcon, typeof Code2> = {
    code: Code2,
    preview: Eye,
    editor: Columns2,
    examples: Library,
    settings: Settings,
};

export const tabId = (id: Panel) => `tab-${id}`;
export const panelId = (id: Panel) => `panel-${id}`;

/** A bottom tab bar with the ARIA tabs keyboard model (arrow keys, Home, End). */
export function TabBar({ tabs, selected, onSelect }: {
    tabs: TabDefinition[];
    selected: Panel;
    onSelect: (panel: Panel) => void;
}) {
    const selectedTab = tabs.find((tab) => tab.panels.includes(selected)) || tabs[0];
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const index = tabs.findIndex((tab) => tab.id === selectedTab.id);
        const next = {
            ArrowRight: (index + 1) % tabs.length,
            ArrowLeft: (index - 1 + tabs.length) % tabs.length,
            Home: 0,
            End: tabs.length - 1,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onSelect(tabs[next].id);
        document.getElementById(tabId(tabs[next].id))?.focus();
    };
    return (
        <nav className="TabBar" role="tablist" aria-label="Editor sections" onKeyDown={onKeyDown}>
            {tabs.map((tab) => {
                const Icon = tabIcons[tab.icon];
                const isSelected = tab.id === selectedTab.id;
                return (
                    <button
                        key={tab.id}
                        id={tabId(tab.id)}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        aria-controls={panelId(tab.id)}
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => onSelect(tab.id)}
                    >
                        <Icon {...iconProps} /><span>{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
