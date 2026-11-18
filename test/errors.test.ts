import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { describeError } from '../src/board/errors';
import { JiraApiError } from '../src/services/JiraService';

function tlsError(code: string, message: string): Error {
    const error = new Error(message) as NodeJS.ErrnoException;
    error.code = code;
    return error;
}

test('certificate chain failures point at the system CA switch, not at the job path', () => {
    const described = describeError(
        tlsError(
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'
        )
    );
    assert.match(described.message, /TLS/);
    assert.match(described.hint ?? '', /NODE_USE_SYSTEM_CA/);
    assert.match(described.hint ?? '', /run-qodercn\.cmd/);
    assert.doesNotMatch(described.hint ?? '', /jenkinsJobPath|jenkins\.token/);
});

test('a message without an error code still gets the chain hint', () => {
    const described = describeError(new Error('unable to verify the first certificate'));
    assert.match(described.hint ?? '', /NODE_USE_SYSTEM_CA/);
});

test('hostname mismatch gets its own hint', () => {
    const described = describeError(
        tlsError(
            'ERR_TLS_CERT_ALTNAME_INVALID',
            "Hostname/IP does not match certificate's altnames: Host: a. is not in the cert's altnames: DNS:b"
        )
    );
    assert.match(described.message, /主机名/);
    assert.match(described.hint ?? '', /intranetTls/);
});

test('unrelated failures keep their raw message', () => {
    const described = describeError(new Error('boom'));
    assert.equal(described.message, 'boom');
    assert.equal(described.hint, undefined);
});

test('400 banner carries Jira errorMessages instead of bare status', () => {
    const error = new JiraApiError(
        400,
        'Jira API error 400',
        JSON.stringify({
            errorMessages: ["The value 'NEX2-1100' does not exist for the field 'project'."],
            errors: {},
        })
    );
    assert.match(error.readable, /NEX2-1100/);
    assert.match(describeError(error).message, /NEX2-1100/);
});

test('400 with field-level errors joins them into the banner', () => {
    const error = new JiraApiError(400, 'Jira API error 400', JSON.stringify({ errorMessages: [], errors: { summary: '不能为空' } }));
    assert.match(error.readable, /不能为空/);
});

test('400 with unparseable body keeps the bare status', () => {
    const error = new JiraApiError(400, 'Jira API error 400', '<html>');
    assert.equal(error.readable, 'Jira 请求失败 400');
});
