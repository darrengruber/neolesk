import type { ReactNode } from 'react';

interface ModalProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    actions?: ReactNode;
    headerExtras?: ReactNode;
}

const Modal = ({ open, title, onClose, children, actions, headerExtras }: ModalProps): JSX.Element | null => {
    if (!open) {
        return null;
    }

    return (
        <div className="ModalBackdrop" onClick={onClose}>
            <div className="ModalSurface" onClick={(event) => event.stopPropagation()}>
                <div className="ModalHeader">
                    <h2>{title}</h2>
                    <div className="ModalHeaderExtras">{headerExtras}</div>
                </div>
                <div className="ModalBody">{children}</div>
                <div className="ModalFooter">
                    {actions}
                    <button type="button" className="ModalButton" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Modal;
