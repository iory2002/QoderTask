import type { BoardColumn, FieldKind, FieldOption, TransitionField, TransitionForm, TransitionOption } from '../models/Board';

export interface RawFieldMeta {
    required?: boolean;
    name?: string;
    schema?: { type?: string; items?: string; system?: string; custom?: string; customId?: number };
    allowedValues?: any[];
    hasDefaultValue?: boolean;
    operations?: string[];
}

export interface BuildFormInput {
    key: string;
    column: BoardColumn;
    transition: TransitionOption;
    /** transitions 元数据里的 fields 字典 */
    fieldsMeta: Record<string, RawFieldMeta> | undefined;
    /** issue 自身的字段值：预填的唯一可靠来源 */
    issueFields: Record<string, any>;
    jiraUrl: string;
}

/** 只支持这四类控件，其余硬阻断 */
function fieldKind(meta: RawFieldMeta): FieldKind {
    const type = meta.schema?.type ?? '';
    const items = meta.schema?.items ?? '';

    if (type === 'string') {
        return meta.schema?.system === 'description' ? 'textarea' : 'text';
    }
    if (type === 'option' || type === 'priority' || type === 'issuetype' || type === 'resolution') {
        return 'select';
    }
    if (type === 'array') {
        return items === 'option' || items === 'string' || items === 'component' || items === 'version'
            ? 'multiselect'
            : 'unsupported';
    }
    if (type === 'user' || type === 'assignee') {
        return 'user';
    }
    return 'unsupported';
}

function optionLabel(value: any): string {
    return String(value?.name ?? value?.value ?? value?.displayName ?? value?.id ?? '');
}

function toOptions(allowed: any[] | undefined): FieldOption[] {
    if (!allowed) {
        return [];
    }
    return allowed.slice(0, 200).map((entry) => ({ id: String(entry.id ?? entry.name ?? ''), label: optionLabel(entry) }));
}

/** 按控件类型把 issue 当前值转成展示值与回传值 */
function prefill(kind: FieldKind, current: any): { value: string | string[] | null; raw: unknown } {
    if (current === undefined || current === null) {
        return { value: kind === 'multiselect' ? [] : null, raw: current ?? null };
    }

    switch (kind) {
        case 'multiselect': {
            const list = Array.isArray(current) ? current : [current];
            return { value: list.map((entry) => String(entry?.id ?? entry)), raw: current };
        }
        case 'select':
            return { value: String(current?.id ?? current), raw: current };
        case 'user':
            return { value: String(current?.name ?? current), raw: current };
        case 'text':
        case 'textarea':
            return { value: typeof current === 'string' ? current : String(optionLabel(current)), raw: current };
        default:
            return { value: null, raw: current };
    }
}

/**
 * 从 transitions 元数据 + issue 当前字段值构建表单。
 *
 * 预填必须来自 issue 自身字段：transitions 元数据里的 fields 不携带当前值，
 * 一路回车即可提交是本表单的主路径。
 */
export function buildTransitionForm(input: BuildFormInput): TransitionForm {
    const fields: TransitionField[] = [];
    const unsupportedFields: string[] = [];
    const meta = input.fieldsMeta ?? {};

    for (const [id, fieldMeta] of Object.entries(meta)) {
        const operations = fieldMeta.operations;
        if (operations && !operations.includes('set') && !fieldMeta.required) {
            continue;
        }

        const kind = fieldKind(fieldMeta);
        const label = fieldMeta.name ?? id;
        const options = toOptions(fieldMeta.allowedValues);
        const current = input.issueFields[id];
        const filled = prefill(kind, current);

        if (kind === 'unsupported') {
            unsupportedFields.push(`${label}（${fieldMeta.schema?.type ?? '未知类型'}）`);
        }

        fields.push({
            id,
            name: label,
            required: fieldMeta.required === true,
            kind,
            schemaType: fieldMeta.schema?.type ?? 'unknown',
            options,
            value: filled.value,
            raw: filled.raw,
        });
    }

    // 必填项排在前面，普通字段保持 Jira 的顺序
    fields.sort((left, right) => Number(right.required) - Number(left.required));

    return {
        key: input.key,
        columnId: input.column.id,
        columnName: input.column.name,
        transition: input.transition,
        fields,
        unsupportedFields,
        jiraUrl: input.jiraUrl,
    };
}

/**
 * 只把用户改动过的字段变成 Jira 的写入形状。
 * 未改动的一律不进请求——这些字段当前值本来就满足校验。
 */
export function collectChangedFields(form: TransitionForm, values: Record<string, string | string[] | null>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const field of form.fields) {
        if (field.kind === 'unsupported') {
            continue;
        }
        const next = values[field.id] ?? null;
        if (sameValue(field.value, next)) {
            continue;
        }
        switch (field.kind) {
            case 'select':
                payload[field.id] = next === null ? null : { id: next };
                break;
            case 'multiselect':
                payload[field.id] = Array.isArray(next) ? next.map((id) => ({ id })) : [];
                break;
            case 'user':
                payload[field.id] = next === null ? null : { name: next };
                break;
            default:
                payload[field.id] = next;
                break;
        }
    }

    return payload;
}

function sameValue(left: string | string[] | null, right: string | string[] | null): boolean {
    if (Array.isArray(left) || Array.isArray(right)) {
        const leftArray = Array.isArray(left) ? left : left === null ? [] : [left];
        const rightArray = Array.isArray(right) ? right : right === null ? [] : [right];
        return leftArray.length === rightArray.length && leftArray.every((item, index) => item === rightArray[index]);
    }
    return left === right;
}

/** 必填项为空时不允许提交 */
export function missingRequired(form: TransitionForm, values: Record<string, string | string[] | null>): string[] {
    return form.fields
        .filter((field) => field.required && field.kind !== 'unsupported')
        .filter((field) => {
            const value = values[field.id];
            if (Array.isArray(value)) {
                return value.length === 0;
            }
            return value === null || value === undefined || String(value).trim() === '';
        })
        .map((field) => field.name);
}
