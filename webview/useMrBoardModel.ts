import { useEffect, useMemo, useState } from 'preact/hooks';

import type { MrBoardPayload, MrExtensionResponse } from '../src/models/MrBoard';
import { onMessage, post } from './mrApi';

export interface MrBoardModel {
    state: MrBoardPayload | null;
    error: string | null;
    refresh(force?: boolean): void;
}

/**
 * 单一数据源：扩展推 mrBoard:state 进来，WebView 只负责渲染。
 * 指纹未变时直接丢弃，避免重绘丢滚动位置与右键菜单位置。
 */
export function useMrBoardModel(): MrBoardModel {
    const [state, setState] = useState<MrBoardPayload | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const off = onMessage((message: MrExtensionResponse) => {
            if (message.type === 'mrBoard:state') {
                setState((previous) => {
                    if (previous && previous.revision === message.payload.revision) {
                        return previous;
                    }
                    return message.payload;
                });
                setError(null);
            } else if (message.type === 'mrBoard:error') {
                setError(message.payload.message);
            }
        });
        post({ type: 'mrBoard:ready' });
        return off;
    }, []);

    return useMemo(
        () => ({
            state,
            error,
            refresh: (force?: boolean) => post({ type: 'mrBoard:refresh', payload: { force } }),
        }),
        [state, error]
    );
}
