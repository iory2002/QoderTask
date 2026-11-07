import { useEffect, useMemo, useState } from 'preact/hooks';

import type {
    BoardStatePayload,
    ExtensionResponse,
    TransitionAvailability,
    TransitionResult,
    TransitionWriteRequest,
} from '../src/models/Board';
import { onMessage, post } from './api';

export interface BoardModel {
    state: BoardStatePayload | null;
    error: string | null;
    /** 正在拖拽的那张卡可用的动作；null = 没有拖拽或还没拿到 */
    availability: TransitionAvailability | null;
    /** 最近一次写入结果，消费完要 clear */
    transitionResult: TransitionResult | null;
    refresh(force?: boolean): void;
    setScope(projects: string[], onlyMine: boolean): void;
    fetchTransitions(key: string): void;
    clearAvailability(): void;
    submitTransition(request: TransitionWriteRequest): void;
    clearTransitionResult(): void;
}

/**
 * 单一数据源：扩展推 board:state 进来，WebView 只负责渲染。
 * 数据指纹未变时直接丢弃，避免重绘丢滚动位置与选中态。
 */
export function useBoardModel(): BoardModel {
    const [state, setState] = useState<BoardStatePayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [availability, setAvailability] = useState<TransitionAvailability | null>(null);
    const [transitionResult, setTransitionResult] = useState<TransitionResult | null>(null);

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
            } else if (message.type === 'card:transitions') {
                setAvailability(message.payload);
            } else if (message.type === 'card:transitionResult') {
                setTransitionResult(message.payload);
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
            availability,
            transitionResult,
            refresh: (force?: boolean) => post({ type: 'board:refresh', payload: { force } }),
            setScope: (projects: string[], onlyMine: boolean) =>
                post({ type: 'board:setScope', payload: { projects, onlyMine } }),
            fetchTransitions: (key: string) => post({ type: 'card:fetchTransitions', payload: { key } }),
            clearAvailability: () => setAvailability(null),
            submitTransition: (request: TransitionWriteRequest) => post({ type: 'card:transition', payload: request }),
            clearTransitionResult: () => setTransitionResult(null),
        }),
        [state, error, availability, transitionResult]
    );
}
