import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    ContextBuilder,
    type InitialContextParams
} from '../src/orchestration/ContextBuilder.js';

const TARGET_SOURCE = [
    'export function calculate(value: number): number {',
    '  return value;',
    '}'
].join('\n');

const PYTHON_TEST_SOURCE = [
    'import pytest',
    'from project.service import calculate',
    '',
    '@pytest.fixture',
    'def prepared_value():',
    '    value = 40',
    '    return value',
    '',
    'def expected_result(value):',
    '    return value + 2',
    '',
    '@pytest.mark.parametrize(',
    '    "delta, expected",',
    '    [',
    '        (1, 41),',
    '        (2, 42),',
    '    ],',
    ')',
    'def test_calculate_parametrized(',
    '    prepared_value,',
    '    delta,',
    '    expected',
    '):',
    '    result = calculate(',
    '        prepared_value + delta',
    '    )',
    '',
    '    assert (',
    '        result',
    '        == expected',
    '    )',
    '',
    'def test_calculate_with_helper(prepared_value):',
    '    result = calculate(prepared_value)',
    '',
    '    assert result == expected_result(',
    '        prepared_value',
    '    )'
].join('\n');

const JEST_TEST_SOURCE = [
    "import { describe, expect, it } from '@jest/globals';",
    "import { calculate } from '../src/service.js';",
    '',
    'const createInput = (): number => {',
    '  return 40;',
    '};',
    '',
    "describe.each([",
    "  ['first case', 1, 41],",
    "  ['second case', 2, 42]",
    "])('%s', (_name, delta, expected) => {",
    "  it('preserva il contratto completo', () => {",
    '    const result = calculate(',
    '      createInput() + delta',
    '    );',
    '',
    '    expect(',
    '      result',
    '    ).toBe(',
    '      expected',
    '    );',
    '  });',
    '});'
].join('\n');

describe(
    'BE-P1-27 - ContextBuilder full TEST CONTRACT',
    () => {
        let repositoryRoot: string;

        beforeEach(
            async () => {
                repositoryRoot =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'be-p1-27-'
                        )
                    );

                await fs.mkdir(
                    path.join(
                        repositoryRoot,
                        'src'
                    ),
                    {
                        recursive: true
                    }
                );

                await fs.mkdir(
                    path.join(
                        repositoryRoot,
                        'tests'
                    ),
                    {
                        recursive: true
                    }
                );

                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'src',
                        'service.ts'
                    ),
                    TARGET_SOURCE,
                    'utf8'
                );
            }
        );

        afterEach(
            async () => {
                await fs.rm(
                    repositoryRoot,
                    {
                        recursive: true,
                        force: true
                    }
                );
            }
        );

        const createParams = (
            testFiles: readonly string[]
        ): InitialContextParams => ({
            issueSpec:
                'Correggere calculate rispettando integralmente il test contract.',
            targetFiles: [
                'src/service.ts'
            ],
            testFiles,
            category: 'REPAIR'
        });

        it(
            'include integralmente fixture, helper, parametrizzazione e assertion multilinea Python',
            async () => {
                const testPath =
                    path.join(
                        repositoryRoot,
                        'tests',
                        'test_service.py'
                    );

                await fs.writeFile(
                    testPath,
                    PYTHON_TEST_SOURCE,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/test_service.py'
                        ])
                    );

                expect(payload).toContain(
                    'TEST CONTRACT (read-only): tests/test_service.py'
                );

                expect(payload).toContain(
                    PYTHON_TEST_SOURCE
                );

                expect(payload).toContain(
                    'import pytest'
                );

                expect(payload).toContain(
                    '@pytest.fixture'
                );

                expect(payload).toContain(
                    'def prepared_value():'
                );

                expect(payload).toContain(
                    'def expected_result(value):'
                );

                expect(payload).toContain(
                    '@pytest.mark.parametrize('
                );

                expect(payload).toContain(
                    '"delta, expected",'
                );

                expect(payload).toContain(
                    '    assert ('
                );

                expect(payload).toContain(
                    '        == expected'
                );

                expect(payload).toContain(
                    '    assert result == expected_result('
                );
            }
        );

        it(
            'include integralmente import, helper, describe.each e assertion multilinea Jest',
            async () => {
                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'service.test.ts'
                    ),
                    JEST_TEST_SOURCE,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/service.test.ts'
                        ])
                    );

                expect(payload).toContain(
                    'TEST CONTRACT (read-only): tests/service.test.ts'
                );

                expect(payload).toContain(
                    JEST_TEST_SOURCE
                );

                expect(payload).toContain(
                    "import { describe, expect, it } from '@jest/globals';"
                );

                expect(payload).toContain(
                    'const createInput = (): number => {'
                );

                expect(payload).toContain(
                    'describe.each(['
                );

                expect(payload).toContain(
                    '    expect('
                );

                expect(payload).toContain(
                    '    ).toBe('
                );
            }
        );

        it(
            'non riduce il TEST CONTRACT alle sole signature o assertion riconosciute lessicalmente',
            async () => {
                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'test_service.py'
                    ),
                    PYTHON_TEST_SOURCE,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/test_service.py'
                        ])
                    );

                /*
                 * Queste righe sarebbero state perse dal precedente
                 * extractSignaturesAndAssertions().
                 */
                expect(payload).toContain(
                    'import pytest'
                );

                expect(payload).toContain(
                    '    value = 40'
                );

                expect(payload).toContain(
                    '    return value'
                );

                expect(payload).toContain(
                    '        (1, 41),'
                );

                expect(payload).toContain(
                    '        prepared_value + delta'
                );
            }
        );

        it(
            'include tutti i test autorizzati come contract read-only completi',
            async () => {
                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'test_service.py'
                    ),
                    PYTHON_TEST_SOURCE,
                    'utf8'
                );

                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'service.test.ts'
                    ),
                    JEST_TEST_SOURCE,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/test_service.py',
                            'tests/service.test.ts'
                        ])
                    );

                expect(payload).toContain(
                    'TEST CONTRACT (read-only): tests/test_service.py'
                );

                expect(payload).toContain(
                    'TEST CONTRACT (read-only): tests/service.test.ts'
                );

                expect(payload).toContain(
                    PYTHON_TEST_SOURCE
                );

                expect(payload).toContain(
                    JEST_TEST_SOURCE
                );
            }
        );

        it(
            'mantiene integralmente lo stesso TEST CONTRACT nel refinement context',
            async () => {
                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'test_service.py'
                    ),
                    PYTHON_TEST_SOURCE,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const initialPayload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/test_service.py'
                        ])
                    );

                const refinementPayload =
                    builder.buildRefinementPayload({
                        iteration: 2,

                        previousCandidatePatch:
                            [
                                'diff --git a/src/service.ts b/src/service.ts',
                                '--- a/src/service.ts',
                                '+++ b/src/service.ts',
                                '@@ -2 +2 @@',
                                '-  return value;',
                                '+  return value + 1;'
                            ].join('\n'),

                        currentFeedback: {
                            rootCauseSummary:
                                'Il risultato non soddisfa il test contract.',
                            violationsPrunedCount: 0,
                            targetRemediations: [
                                {
                                    file:
                                        'src/service.ts',

                                    lineRange: {
                                        start: 2,
                                        end: 2
                                    },

                                    rootCause:
                                        'Il valore restituito è errato.',

                                    mandatoryCorrection:
                                        'Restituire il valore richiesto dal contratto.'
                                }
                            ],
                            securityPriorityStrict: true,
                            flappingDetected: false
                        },

                        cumulativeRemediations: [
                            {
                                key:
                                    'src/service.ts||restituire',

                                remediation: {
                                    file:
                                        'src/service.ts',

                                    lineRange: {
                                        start: 2,
                                        end: 2
                                    },

                                    rootCause:
                                        'Il valore restituito è errato.',

                                    mandatoryCorrection:
                                        'Restituire il valore richiesto dal contratto.'
                                },

                                firstObservedIteration: 1,
                                lastObservedIteration: 1,
                                observationCount: 1
                            }
                        ],

                        currentFailure:
                            'Functional test failure'
                    });

                expect(initialPayload).toContain(
                    PYTHON_TEST_SOURCE
                );

                expect(refinementPayload).toContain(
                    PYTHON_TEST_SOURCE
                );

                expect(refinementPayload).toContain(
                    'TEST CONTRACT (read-only): tests/test_service.py'
                );
            }
        );

        it(
            'normalizza soltanto CRLF in LF senza perdere il contenuto del test contract',
            async () => {
                const crlfSource =
                    PYTHON_TEST_SOURCE
                        .replace(
                            /\n/g,
                            '\r\n'
                        );

                await fs.writeFile(
                    path.join(
                        repositoryRoot,
                        'tests',
                        'test_service.py'
                    ),
                    crlfSource,
                    'utf8'
                );

                const builder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await builder.buildInitialPayload(
                        createParams([
                            'tests/test_service.py'
                        ])
                    );

                /*
                 * ContextBuilder.fence() normalizza CRLF a LF.
                 * Il contenuto logico deve comunque essere completo.
                 */
                expect(payload).toContain(
                    PYTHON_TEST_SOURCE
                );

                expect(payload).not.toContain(
                    '\r\n'
                );
            }
        );
    }
);
