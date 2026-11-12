import {
  describe,
  expect,
  it
} from '@jest/globals';

import { DiffScoper } from '../src/verification/DiffScoper.js';
import { SastFinding } from '../src/types/domain.js';

describe(
  'DiffScoper - Deterministic Boundary Verification',
  () => {
    const sampleDiff = [
      '--- a/src/auth.py',
      '+++ b/src/auth.py',
      '@@ -10,3 +10,4 @@',
      ' existing_line()',
      '+new_unsafe_query = "SELECT * FROM users WHERE id = " + user_input',
      '+another_line()'
    ].join('\n');

    it(
      'estrae correttamente il range modificato includendo il contesto configurato',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        expect(
          ranges.has('src/auth.py')
        ).toBe(true);

        const authRanges =
          ranges.get('src/auth.py');

        expect(authRanges).toBeDefined();
        expect(authRanges).toHaveLength(1);

        expect(authRanges![0]).toEqual({
          start: 8,
          end: 15
        });
      }
    );

    it(
      'usa newStart invece di oldStart per determinare le coordinate del file risultante',
      () => {
        const diff = [
          '--- a/src/example.py',
          '+++ b/src/example.py',
          '@@ -10,2 +20,3 @@',
          ' existing()',
          '+first_added()',
          '+second_added()'
        ].join('\n');

        const ranges =
          DiffScoper.extractModifiedLineRanges(
            diff
          );

        const exampleRanges =
          ranges.get('src/example.py');

        expect(exampleRanges).toBeDefined();
        expect(exampleRanges).toHaveLength(1);

        expect(exampleRanges![0]).toEqual({
          start: 18,
          end: 25
        });
      }
    );

    it(
      'in CREATE trattiene soltanto finding che intersecano il codice interessato dalla patch',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const mockFindings:
          SastFinding[] = [
            {
              ruleId:
                'python.lang.security.injection.sql',
              path: 'src/auth.py',
              startLine: 11,
              endLine: 11,
              severity: 'ERROR',
              message:
                'SQL Injection rilevata'
            },
            {
              ruleId:
                'python.lang.best-practice.unused-import',
              path: 'src/auth.py',
              startLine: 2,
              endLine: 2,
              severity: 'WARNING',
              message:
                'Import inutilizzato'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            mockFindings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(1);

        expect(
          scoped[0]!.startLine
        ).toBe(11);

        expect(
          scoped[0]!.ruleId
        ).toBe(
          'python.lang.security.injection.sql'
        );
      }
    );

    it(
      'in REPAIR mantiene una vulnerabilità di sicurezza sul target anche fuori dal delta della patch',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'security.sql-injection',
              path: 'src/auth.py',
              startLine: 2,
              endLine: 2,
              severity: 'ERROR',
              message:
                'Vulnerabilità preesistente sul target'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'REPAIR'
          );

        expect(scoped).toHaveLength(1);

        expect(
          scoped[0]!.ruleId
        ).toBe(
          'security.sql-injection'
        );
      }
    );

    it(
      'in CREATE non include automaticamente una vulnerabilità preesistente lontana dal delta',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'security.sql-injection',
              path: 'src/auth.py',
              startLine: 2,
              endLine: 2,
              severity: 'ERROR',
              message:
                'Vulnerabilità preesistente'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(0);
      }
    );

    it(
      'in REPAIR non estende la regola speciale di sicurezza a file che non sono target',
      () => {
        const diff = [
          '--- a/src/helper.py',
          '+++ b/src/helper.py',
          '@@ -20,1 +20,2 @@',
          ' existing()',
          '+new_line()'
        ].join('\n');

        const ranges =
          DiffScoper.extractModifiedLineRanges(
            diff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'security.issue',
              path: 'src/helper.py',
              startLine: 2,
              endLine: 2,
              severity: 'ERROR',
              message:
                'Security finding outside modified range'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'REPAIR'
          );

        expect(scoped).toHaveLength(0);
      }
    );

    it(
      'considera una finding rilevante quando il suo intervallo interseca il range modificato',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'range-overlap',
              path: 'src/auth.py',
              startLine: 5,
              endLine: 9,
              severity: 'WARNING',
              message:
                'Finding che attraversa il confine del range'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(1);
      }
    );

    it(
      'esclude una finding quando il suo intervallo non interseca alcun range modificato',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'outside-range',
              path: 'src/auth.py',
              startLine: 1,
              endLine: 4,
              severity: 'WARNING',
              message:
                'Finding completamente esterna'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(0);
      }
    );

    it(
      'considera tutto il contenuto introdotto da un nuovo file CREATE',
      () => {
        const diff = [
          'diff --git a/src/generated.py b/src/generated.py',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/generated.py',
          '@@ -0,0 +1,4 @@',
          '+def generated(value):',
          '+    query = "SELECT * FROM users WHERE id = " + value',
          '+    return query',
          '+'
        ].join('\n');

        const ranges =
          DiffScoper.extractModifiedLineRanges(
            diff
          );

        expect(
          ranges.get('src/generated.py')
        ).toEqual([
          {
            start: 1,
            end: 4
          }
        ]);

        const findings:
          SastFinding[] = [
            {
              ruleId: 'sql-injection',
              path: 'src/generated.py',
              startLine: 2,
              endLine: 2,
              severity: 'ERROR',
              message:
                'SQL injection nel nuovo file'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(1);
      }
    );

    it(
      'gestisce patch CREATE multi-file mantenendo range separati',
      () => {
        const diff = [
          'diff --git a/src/auth.py b/src/auth.py',
          '--- a/src/auth.py',
          '+++ b/src/auth.py',
          '@@ -10,2 +10,3 @@',
          ' existing()',
          '+added_to_auth()',
          'diff --git a/src/helper.py b/src/helper.py',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/helper.py',
          '@@ -0,0 +1,2 @@',
          '+def helper():',
          '+    return True'
        ].join('\n');

        const ranges =
          DiffScoper.extractModifiedLineRanges(
            diff
          );

        expect(
          ranges.has('src/auth.py')
        ).toBe(true);

        expect(
          ranges.has('src/helper.py')
        ).toBe(true);

        expect(
          ranges.get('src/helper.py')
        ).toEqual([
          {
            start: 1,
            end: 2
          }
        ]);
      }
    );

    it(
      'normalizza i path restituiti da Semgrep prima del matching',
      () => {
        const ranges =
          DiffScoper.extractModifiedLineRanges(
            sampleDiff
          );

        const findings:
          SastFinding[] = [
            {
              ruleId: 'normalized-path',
              path: './src/auth.py',
              startLine: 11,
              endLine: 11,
              severity: 'WARNING',
              message:
                'Finding con path normalizzato'
            }
          ];

        const scoped =
          DiffScoper.filterFindings(
            findings,
            ranges,
            ['src/auth.py'],
            'CREATE'
          );

        expect(scoped).toHaveLength(1);
      }
    );

    it(
      'unisce range sovrapposti o adiacenti appartenenti allo stesso file',
      () => {
        const diff = [
          '--- a/src/example.py',
          '+++ b/src/example.py',
          '@@ -10,1 +10,2 @@',
          ' existing_a()',
          '+added_a()',
          '@@ -15,1 +16,2 @@',
          ' existing_b()',
          '+added_b()'
        ].join('\n');

        const ranges =
          DiffScoper.extractModifiedLineRanges(
            diff
          );

        const exampleRanges =
          ranges.get('src/example.py');

        expect(exampleRanges).toBeDefined();
        expect(exampleRanges).toHaveLength(1);
      }
    );
  }
);
