import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { encodeJobPath } from '../src/services/JenkinsService';

test('each job segment is encoded once more, so the branch slash becomes %252F', () => {
    const path = 'UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F7.10.x';
    assert.equal(
        encodeJobPath(path),
        '/job/UltrasoundGeneralImaging/job/ultrasoundgeneralimaging%252Fgipc-app/job/nexus%252Fdev%252F7.10.x'
    );
});

test('the 5.10.x chain encodes the same way as the 7.10.x one', () => {
    const path = 'UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F5.10.x';
    assert.equal(
        encodeJobPath(path),
        '/job/UltrasoundGeneralImaging/job/ultrasoundgeneralimaging%252Fgipc-app/job/nexus%252Fdev%252F5.10.x'
    );
});

test('tolerates leading, trailing and doubled slashes in the configured path', () => {
    assert.equal(encodeJobPath('/a/b/'), '/job/a/job/b');
    assert.equal(encodeJobPath('a//b'), '/job/a/job/b');
});
