interface LoadingOverlayProps {
    message: string;
    detail?: string;
}

function LoadingOverlay({ message, detail }: LoadingOverlayProps): JSX.Element {
    return (
        <div className="LoadingOverlay">
            <div className="LoadingOverlayCard">
                <div className="LoadingOverlaySpinner">
                    <svg viewBox="0 0 40 40" className="LoadingOverlayRing">
                        <circle cx="20" cy="20" r="16" />
                    </svg>
                    <span className="LoadingOverlayDot" />
                </div>
                <span className="LoadingOverlayMessage">{message}</span>
                {detail ? <span className="LoadingOverlayDetail">{detail}</span> : null}
            </div>
        </div>
    );
}

export default LoadingOverlay;
