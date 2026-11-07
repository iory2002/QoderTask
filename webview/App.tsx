import { useCallback, useEffect, useState } from 'preact/hooks';

import type { BoardColumn, ColumnDropRule, TransitionForm } from '../src/models/Board';
import { Board } from './components/Board';
import { Banners } from './components/Banners';
import { DetailPanel } from './components/DetailPanel';
import { TopBar } from './components/TopBar';
import { TransitionDialog } from './components/TransitionDialog';
import { showToast, Toaster } from './toast';
import { useBoardModel } from './useBoardModel';

export function App() {
    const model = useBoardModel();
    const state = model.state;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [form, setForm] = useState<TransitionForm | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const closeDetail = useCallback(() => setSelectedKey(null), []);

    const closeForm = useCallback(() => {
        setForm(null);
        setSubmitting(false);
        setSubmitError(null);
        setFieldErrors({});
    }, []);

    // 当前的详情从 state 里取，轮询更新会直接反映在浮层上，不抢焦点
    const selected = state && selectedKey ? state.cards.find((card) => card.key === selectedKey) : undefined;

    // 写入结果只消费一次
    const result = model.transitionResult;
    useEffect(() => {
        if (!result) {
            return;
        }
        if (result.ok) {
            showToast(`${result.key} 已写入 Jira`);
            closeForm();
            setSelectedKey(null);
        } else {
            setSubmitting(false);
            setSubmitError(result.error ?? '写入失败');
            setFieldErrors(result.fieldErrors ?? {});
        }
        model.clearTransitionResult();
    }, [result]);

    const handleDrop = useCallback((cardKey: string, column: BoardColumn, rule: ColumnDropRule) => {
        if (!rule.legal) {
            showToast(rule.reason ?? `不能放到「${column.name}」`, 'error');
            return;
        }
        if (!rule.form) {
            showToast('这张卡的表单还没准备好，请重新拖一次', 'error');
            return;
        }
        setSubmitError(null);
        setFieldErrors({});
        setSubmitting(false);
        setForm(rule.form);
        void cardKey;
    }, []);

    const submit = useCallback(
        (fields: Record<string, unknown>) => {
            if (!form) {
                return;
            }
            setSubmitting(true);
            setSubmitError(null);
            setFieldErrors({});
            model.submitTransition({ key: form.key, transitionId: form.transition.id, fields });
        },
        [form, model]
    );

    return (
        <div class="app">
            <TopBar model={model} />
            {model.error ? (
                <div class="banners">
                    <div class="banner error">{model.error}</div>
                </div>
            ) : null}
            {state ? <Banners notices={state.notices} stale={state.freshness.stale} /> : null}
            {state ? (
                <Board
                    state={state}
                    availability={model.availability}
                    onRetry={() => model.refresh(true)}
                    onOpenDetail={setSelectedKey}
                    onDragStart={(key) => model.fetchTransitions(key)}
                    onDragEnd={() => model.clearAvailability()}
                    onDrop={handleDrop}
                />
            ) : (
                <div class="placeholder">
                    <h3>正在读取 Jira 看板…</h3>
                    <span>首次加载会拉取 board 配置与活跃 sprint。</span>
                </div>
            )}
            {state && selected ? <DetailPanel card={selected} state={state} onClose={closeDetail} /> : null}
            {form ? (
                <TransitionDialog
                    form={form}
                    submitting={submitting}
                    error={submitError}
                    fieldErrors={fieldErrors}
                    onCancel={closeForm}
                    onSubmit={submit}
                />
            ) : null}
            <Toaster />
        </div>
    );
}
