import { useEffect, useState } from 'preact/hooks';

type ToastKind = 'info' | 'error';

interface ToastMessage {
    id: number;
    message: string;
    kind: ToastKind;
}

const TOAST_EVENT = 'jira-board:toast';
let sequence = 0;

/** 任何组件都能发一条 toast，不需要层层传回调 */
export function showToast(message: string, kind: ToastKind = 'info'): void {
    sequence += 1;
    window.dispatchEvent(
        new CustomEvent<ToastMessage>(TOAST_EVENT, { detail: { id: sequence, message, kind } })
    );
}

export function Toaster() {
    const [toast, setToast] = useState<ToastMessage | null>(null);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const listener = (event: Event) => {
            const detail = (event as CustomEvent<ToastMessage>).detail;
            setToast(detail);
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => setToast(null), 4200);
        };
        window.addEventListener(TOAST_EVENT, listener);
        return () => {
            window.removeEventListener(TOAST_EVENT, listener);
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        };
    }, []);

    if (!toast) {
        return null;
    }
    return (
        <div class={toast.kind === 'error' ? 'toast error' : 'toast'} role="status">
            {toast.message}
        </div>
    );
}
