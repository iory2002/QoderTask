import { useState } from 'preact/hooks';

import type { FieldOption, TransitionField, TransitionForm } from '../../src/models/Board';
import { post } from '../api';
import { collectChangedFields, missingRequired } from '../../src/board/transitionForm';

export function TransitionDialog({
    form,
    submitting,
    error,
    fieldErrors,
    onCancel,
    onSubmit,
}: {
    form: TransitionForm;
    submitting: boolean;
    error: string | null;
    fieldErrors: Record<string, string>;
    onCancel: () => void;
    onSubmit: (fields: Record<string, unknown>) => void;
}) {
    const [values, setValues] = useState<Record<string, string | string[] | null>>(() => {
        const initial: Record<string, string | string[] | null> = {};
        for (const field of form.fields) {
            initial[field.id] = field.value;
        }
        return initial;
    });

    const missing = missingRequired(form, values);
    const blocked = form.unsupportedFields.length > 0;
    const canSubmit = !submitting && !blocked && missing.length === 0;

    const setValue = (field: TransitionField, next: string | string[] | null) => {
        setValues((current) => ({ ...current, [field.id]: next }));
    };

    return (
        <div class="modal-layer">
            <dialog open class="transition-dialog">
                <div class="dlg-head">
                    {form.transition.name} · {form.key}
                    <div class="spacer" />
                    <span class="hint">→ {form.columnName}</span>
                </div>

                <div class="dlg-body">
                    {blocked ? (
                        <div class="warn">
                            <b>这些字段插件填不了，请到 Jira 完成：</b>
                            <ul>
                                {form.unsupportedFields.map((name) => (
                                    <li key={name}>{name}</li>
                                ))}
                            </ul>
                            <button
                                class="btn"
                                onClick={() => post({ type: 'board:openExternal', payload: { url: form.jiraUrl } })}
                            >
                                在 Jira 中完成
                            </button>
                        </div>
                    ) : (
                        <div class="hint">
                            字段已按这张 issue 的当前值填好，只提交你改动过的项；不改就无需填写。
                        </div>
                    )}

                    {error ? <div class="banner error">{error}</div> : null}

                    {form.fields.map((field) => (
                        <div class={field.kind === 'unsupported' ? 'field unsupported' : 'field'} key={field.id}>
                            <label>
                                {field.name}
                                {field.required ? <span class="req"> *</span> : null}
                                {field.kind === 'unsupported' ? (
                                    <span class="hint"> · 不支持的类型 {field.schemaType}</span>
                                ) : null}
                            </label>
                            <FieldControl
                                field={field}
                                value={values[field.id] ?? null}
                                disabled={submitting}
                                onChange={(next) => setValue(field, next)}
                            />
                            {fieldErrors[field.id] ? <div class="err">{fieldErrors[field.id]}</div> : null}
                        </div>
                    ))}

                    {missing.length > 0 && !blocked ? (
                        <div class="hint">还差必填项：{missing.join('、')}</div>
                    ) : null}
                </div>

                <div class="dlg-foot">
                    <button class="btn" onClick={onCancel} disabled={submitting}>
                        取消
                    </button>
                    <button
                        class="btn primary"
                        disabled={!canSubmit}
                        onClick={() => onSubmit(collectChangedFields(form, values))}
                    >
                        {submitting ? '提交中…' : `提交并移动到 ${form.columnName}`}
                    </button>
                </div>
            </dialog>
        </div>
    );
}

function FieldControl({
    field,
    value,
    disabled,
    onChange,
}: {
    field: TransitionField;
    value: string | string[] | null;
    disabled: boolean;
    onChange: (next: string | string[] | null) => void;
}) {
    if (field.kind === 'unsupported') {
        return <input value="（不支持，请在 Jira 中完成）" disabled />;
    }

    if (field.kind === 'textarea') {
        return (
            <textarea
                rows={3}
                value={value === null ? '' : String(value)}
                disabled={disabled}
                onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
            />
        );
    }

    if (field.kind === 'text') {
        return (
            <input
                value={value === null ? '' : String(value)}
                disabled={disabled}
                onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
            />
        );
    }

    if (field.kind === 'select') {
        if (field.options.length === 0) {
            return (
                <input
                    value={value === null ? '' : labelOf(field.options, String(value))}
                    disabled
                    title="Jira 没有给出可选项，保持当前值"
                />
            );
        }
        return (
            <select
                value={value === null ? '' : String(value)}
                disabled={disabled}
                onChange={(event) => {
                    // 「（不修改）」= 还原成预填值，绝不能用空值去清空 Jira 字段
                    const picked = (event.currentTarget as HTMLSelectElement).value;
                    onChange(picked === '' ? field.value : picked);
                }}
            >
                <option value="">（不修改）</option>
                {withCurrent(field.options, value as string | null).map((option) => (
                    <option value={option.id} key={option.id}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
    }

    if (field.kind === 'user') {
        if (field.options.length > 0) {
            return (
                <select
                    value={value === null ? '' : String(value)}
                    disabled={disabled}
                    onChange={(event) => {
                        const picked = (event.currentTarget as HTMLSelectElement).value;
                        onChange(picked === '' ? field.value : picked);
                    }}
                >
                    <option value="">（不修改）</option>
                    {withCurrent(field.options, value as string | null).map((option) => (
                        <option value={option.id} key={option.id}>
                            {option.label}
                        </option>
                    ))}
                </select>
            );
        }
        return (
            <input
                value={value === null ? '' : String(value)}
                disabled={disabled}
                placeholder="用户名"
                onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
            />
        );
    }

    // multiselect
    const selected = Array.isArray(value) ? value : value === null ? [] : [value];
    return (
        <select
            multiple
            size={Math.min(6, Math.max(3, field.options.length))}
            disabled={disabled}
            onChange={(event) => {
                const target = event.currentTarget as HTMLSelectElement;
                onChange(Array.from(target.selectedOptions).map((option) => option.value));
            }}
        >
            {withCurrent(field.options, selected).map((option) => (
                <option value={option.id} key={option.id} selected={selected.includes(option.id)}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}

function labelOf(options: FieldOption[], id: string): string {
    return options.find((option) => option.id === id)?.label ?? id;
}

/** 当前值可能不在 allowedValues 里（例如已被删除的版本），补进去以免显示成空 */
function withCurrent(options: FieldOption[], current: string | string[] | null): FieldOption[] {
    const list = [...options];
    const ids = Array.isArray(current) ? current : current === null ? [] : [current];
    for (const id of ids) {
        if (id && !list.some((option) => option.id === id)) {
            list.unshift({ id, label: `${id}（当前值）` });
        }
    }
    return list;
}
