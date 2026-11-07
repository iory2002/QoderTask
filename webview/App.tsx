import { useCallback, useEffect, useState } from 'preact/hooks';

import type { BoardColumn, ColumnDropRule, TransitionForm } from '../src/models/Board';
import { checkSoftGate, type GateCheck } from '../src/board/softGate';
import { Board } from './components/Board';
import { Banners } from './components/Banners';
import { DetailPanel } from './components/DetailPanel';
import { SoftGateDialog } from './components/SoftGateDialog';
import { TopBar } from './components/TopBar';
import { TransitionDialog } from './components/TransitionDialog';
import { showToast, Toaster } from './toast';
import { useBoardModel } from './useBoardModel';

export function App() {
    const model = useBoardModel();
    const state = model.state;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [form, setForm] = useState<TransitionForm | null>(null);
    const [gate, setGate] = useState<{ form: TransitionForm; check: GateCheck; columnName: string } | null>(null);
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

    const handleDrop = useCallback(
        (cardKey: string, column: BoardColumn, rule: ColumnDropRule) => {
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

            // 阶段没达标时先亮出缺什么，由用户决定要不要继续
            const card = state?.cards.find((candidate) => candidate.key === cardKey);
            const check = card ? checkSoftGate(card, column.name) : { required: false, items: [], consequence: '' };
            if (check.required) {
                setGate({ form: rule.form, check, columnName: column.name });
                return;
            }
            setForm(rule.form);
        },
        [state]
    );

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
            {gate ? (
                <SoftGateDialog
                    title={`推到 ${gate.columnName} 前，交付阶段未达标`}
                    items={gate.check.items}
                    consequence={gate.check.consequence}
                    onCancel={() => setGate(null)}
                    onProceed={() => {
                        const pendingForm = gate.form;
                        setGate(null);
                        setForm(pendingForm);
                    }}
                />
            ) : null}
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
