import * as path from 'node:path';
import { DiffScoper, type LineRange } from '../src/verification/DiffScoper.js';
import type { SastFinding } from '../src/types/domain.js';

const REPOSITORY_ROOT = path.resolve(
  process.cwd(),
  'tmp',
  'be-p1-24-repository'
);

const TARGET_FILE = 'src/service.ts';

const MODIFIED_RANGES: ReadonlyMap<string, readonly LineRange[]> =
  new Map([
    [
      TARGET_FILE,
      [
        {
          start: 10,
          end: 20
        }
      ]
    ]
  ]);

const createFinding = (
  findingPath: string,
  overrides: Partial<SastFinding> = {}
): SastFinding => ({
  ruleId: 'test.rule',
  path: findingPath,
  startLine: 12,
  endLine: 12,
  severity: 'WARNING',
  message: 'Test finding',
  cweHierarchy: [],
  ...overrides
});

describe('BE-P1-24 - DiffScoper repository path confinement', () => {
  describe('path matching canonico', () => {
    it('associa correttamente un finding repository-relative al target', () => {
      const finding = createFinding(TARGET_FILE);

      const result = DiffScoper.filterFindings(
        [finding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([finding]);
    });

    it('associa correttamente un finding assoluto realmente interno al repository', () => {
      const absoluteInternalPath = path.join(
        REPOSITORY_ROOT,
        'src',
        'service.ts'
      );

      const finding = createFinding(
        absoluteInternalPath
      );

      const result = DiffScoper.filterFindings(
        [finding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([finding]);
    });

    it('canonicalizza segmenti punto nei path repository-relative validi', () => {
      const finding = createFinding(
        './src/./service.ts'
      );

      const result = DiffScoper.filterFindings(
        [finding],
        MODIFIED_RANGES,
        ['./src/service.ts'],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([finding]);
    });

    it('non associa un path assoluto esterno con lo stesso suffix del target', () => {
      const externalRoot = path.resolve(
        path.dirname(REPOSITORY_ROOT),
        'be-p1-24-external-repository'
      );

      const externalFinding = createFinding(
        path.join(
          externalRoot,
          'src',
          'service.ts'
        )
      );

      const result = DiffScoper.filterFindings(
        [externalFinding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([]);
    });

    it('non associa un traversal che tenta di uscire dal repository', () => {
      const traversalFinding = createFinding(
        '../external/src/service.ts'
      );

      const result = DiffScoper.filterFindings(
        [traversalFinding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([]);
    });

    it('non associa un file omonimo in una directory repository-relative differente', () => {
      const otherFinding = createFinding(
        'other/src/service.ts'
      );

      const result = DiffScoper.filterFindings(
        [otherFinding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([]);
    });
  });

  describe('policy REPAIR', () => {
    it('mantiene un finding di sicurezza sul vero target anche fuori dai range modificati', () => {
      const securityFinding = createFinding(
        TARGET_FILE,
        {
          startLine: 100,
          endLine: 100,
          severity: 'ERROR'
        }
      );

      const result = DiffScoper.filterFindings(
        [securityFinding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'REPAIR',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([
        securityFinding
      ]);
    });

    it('non estende la policy REPAIR a un path esterno con lo stesso suffix', () => {
      const externalRoot = path.resolve(
        path.dirname(REPOSITORY_ROOT),
        'be-p1-24-external-repair'
      );

      const externalSecurityFinding = createFinding(
        path.join(
          externalRoot,
          'src',
          'service.ts'
        ),
        {
          startLine: 100,
          endLine: 100,
          severity: 'ERROR'
        }
      );

      const result = DiffScoper.filterFindings(
        [externalSecurityFinding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'REPAIR',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([]);
    });

    it('mantiene invariata la normale selezione per range dei finding non-security', () => {
      const inRange = createFinding(
        TARGET_FILE,
        {
          startLine: 15,
          endLine: 15,
          severity: 'WARNING'
        }
      );

      const outOfRange = createFinding(
        TARGET_FILE,
        {
          startLine: 50,
          endLine: 50,
          severity: 'WARNING'
        }
      );

      const result = DiffScoper.filterFindings(
        [inRange, outOfRange],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'REPAIR',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([inRange]);
    });
  });

  describe('policy CREATE', () => {
    it('mantiene un finding sul file corretto quando interseca il range modificato', () => {
      const finding = createFinding(
        TARGET_FILE,
        {
          startLine: 20,
          endLine: 21,
          severity: 'ERROR'
        }
      );

      const result = DiffScoper.filterFindings(
        [finding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([finding]);
    });

    it('esclude un finding sul file corretto quando non interseca il range modificato', () => {
      const finding = createFinding(
        TARGET_FILE,
        {
          startLine: 21,
          endLine: 21,
          severity: 'ERROR'
        }
      );

      const result = DiffScoper.filterFindings(
        [finding],
        MODIFIED_RANGES,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([]);
    });
  });

  describe('modifiedRanges canonici', () => {
    it('canonicalizza anche le chiavi modifiedRanges prima del confronto', () => {
      const ranges = new Map<
        string,
        readonly LineRange[]
      >([
        [
          './src/./service.ts',
          [
            {
              start: 10,
              end: 20
            }
          ]
        ]
      ]);

      const finding = createFinding(
        TARGET_FILE
      );

      const result = DiffScoper.filterFindings(
        [finding],
        ranges,
        [TARGET_FILE],
        'CREATE',
        REPOSITORY_ROOT
      );

      expect(result).toEqual([finding]);
    });
  });
});
