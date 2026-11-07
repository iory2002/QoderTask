import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildTransitionForm, collectChangedFields, missingRequired } from '../src/board/transitionForm';
import type { RawFieldMeta } from '../src/board/transitionForm';
import type { BoardColumn, TransitionOption } from '../src/models/Board';

const COLUMN: BoardColumn = { id: '3', name: 'In Test', statusIds: ['10401'] };
const TRANSITION: TransitionOption = {
    id: '21',
    name: 'Send to Test',
    toStatusId: '10401',
    toStatusName: 'In Test',
};

const META: Record<string, RawFieldMeta> = {
    summary: {
        required: true,
        name: 'Summary',
        schema: { type: 'string', system: 'summary' },
        operations: ['set'],
    },
    description: {
        required: false,
        name: 'Description',
        schema: { type: 'string', system: 'description' },
        operations: ['set'],
    },
    priority: {
        required: false,
        name: 'Priority',
        schema: { type: 'priority', system: 'priority' },
        allowedValues: [
            { id: '2', name: 'High' },
            { id: '3', name: 'Medium' },
        ],
        operations: ['set'],
    },
    versions: {
        required: true,
        name: 'Fix Version/s',
        schema: { type: 'array', items: 'version' },
        allowedValues: [
            { id: '10', name: 'R2.5.0' },
            { id: '11', name: 'R2.6.0' },
        ],
        operations: ['set'],
    },
    assignee: {
        required: false,
        name: 'Assignee',
        schema: { type: 'user', system: 'assignee' },
        operations: ['set'],
    },
    duedate: {
        required: false,
        name: 'Due date',
        schema: { type: 'date', system: 'duedate' },
        operations: ['set'],
    },
};

const ISSUE_FIELDS = {
    summary: 'Merge on-spot configuration',
    description: 'body',
    priority: { id: '2', name: 'High' },
    versions: [{ id: '10', name: 'R2.5.0' }],
    assignee: { name: 'zhuangyf', displayName: 'Zhuang, Yifan' },
};

function build(issueFields: Record<string, unknown> = ISSUE_FIELDS) {
    return buildTransitionForm({
        key: 'NEX2-932',
        column: COLUMN,
        transition: TRANSITION,
        fieldsMeta: META,
        issueFields,
        jiraUrl: 'http://jira/browse/NEX2-932',
    });
}

test('maps the four supported control families and the prefilled values', () => {
    const form = build();
    const byId = Object.fromEntries(form.fields.map((field) => [field.id, field]));

    assert.equal(byId.summary.kind, 'text');
    assert.equal(byId.summary.value, 'Merge on-spot configuration');
    assert.equal(byId.description.kind, 'textarea');
    assert.equal(byId.priority.kind, 'select');
    assert.equal(byId.priority.value, '2');
    assert.equal(byId.versions.kind, 'multiselect');
    assert.deepEqual(byId.versions.value, ['10']);
    assert.equal(byId.assignee.kind, 'user');
    assert.equal(byId.assignee.value, 'zhuangyf');
});

test('an unsupported field type blocks the form instead of silently dropping it', () => {
    const form = build();
    assert.equal(form.unsupportedFields.length, 1);
    assert.match(form.unsupportedFields[0], /Due date/);
    assert.equal(form.fields.find((field) => field.id === 'duedate')?.kind, 'unsupported');
});

test('required fields come first', () => {
    const form = build();
    assert.equal(form.fields[0].required, true);
    assert.equal(form.fields[1].required, true);
});

test('only changed fields are submitted', () => {
    const form = build();
    const untouched = Object.fromEntries(form.fields.map((field) => [field.id, field.value]));
    assert.deepEqual(collectChangedFields(form, untouched), {});

    const changed = { ...untouched, summary: 'new summary', priority: '3' };
    assert.deepEqual(collectChangedFields(form, changed), {
        summary: 'new summary',
        priority: { id: '3' },
    });
});

test('multiselect and user changes are shaped the way Jira expects', () => {
    const form = build();
    const values = Object.fromEntries(form.fields.map((field) => [field.id, field.value]));
    const payload = collectChangedFields(form, {
        ...values,
        versions: ['10', '11'],
        assignee: 'otheruser',
    });

    assert.deepEqual(payload.versions, [{ id: '10' }, { id: '11' }]);
    assert.deepEqual(payload.assignee, { name: 'otheruser' });
});

test('unsupported fields never leak into the payload', () => {
    const form = build();
    const values: Record<string, string | string[] | null> = { duedate: '2026-11-10' };
    assert.equal('duedate' in collectChangedFields(form, values), false);
});

test('a missing required value blocks submission', () => {
    const form = build({ summary: '', versions: [] });
    assert.deepEqual(missingRequired(form, { summary: '', versions: [] }), ['Summary', 'Fix Version/s']);
});

test('an issue with every required value filled needs no typing', () => {
    const form = build();
    const values = Object.fromEntries(form.fields.map((field) => [field.id, field.value]));
    assert.deepEqual(missingRequired(form, values), []);
});
