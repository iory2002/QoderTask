import { useEffect, useMemo, useState } from 'preact/hooks';

import type { BoardStatePayload, ExtensionResponse } from '../src/models/Board';
import { onMessage, post } from './api';

export interface BoardModel {
    state: BoardStatePayload | null;
    error: string | null;
    refresh(force?: boolean): void;
    setScope(projects: string[], onlyMine: boolean): void;
}

/**
 * 单一数据源：扩展推 board:state 进来，WebView 只负责渲染。
 * 数据指纹未变时直接丢弃，避免重绘丢滚动位置与选中态。
 *
 * 看板只读：这里没有任何写入通道，改状态去 Jira。
 */
export function useBoardModel(): BoardModel {
    const [state, setState] = useState<BoardStatePayload | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const off = onMessage((message: ExtensionResponse) => {
            if (message.type === 'board:state') {
                setState((previous) => {
                    if (previous && previous.revision === message.payload.revision) {
                        return previous;
                    }
                    return message.payload;
                });
                setError(null);
            } else if (message.type === 'board:error') {
                setError(message.payload.message);
            }
        });
        post({ type: 'board:ready' });
        return off;
    }, []);

    return useMemo(
        () => ({
            state,
            error,
            refresh: (force?: boolean) => post({ type: 'board:refresh', payload: { force } }),
            setScope: (projects: string[], onlyMine: boolean) =>
                post({ type: 'board:setScope', payload: { projects, onlyMine } }),
        }),
        [state, error]
    );
}
