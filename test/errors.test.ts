import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { describeError } from '../src/board/errors';

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
