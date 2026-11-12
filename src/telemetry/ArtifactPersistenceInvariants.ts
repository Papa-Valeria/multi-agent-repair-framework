import {
    DEFAULT_PROMPT_PROFILE
} from '../inference/PromptProfile.js';
import type {
    ExperimentMetadata,
    ExperimentModelConfig,
    ExperimentProfile,
    StoredRunV2,
    StoredRunV3,
    StoredRunV4
} from '../types/analytics.js';
import type {
    AgentUsage,
    ComputationalTelemetry,
    WorkbenchSessionState
} from '../types/domain.js';
import {
    DEFAULT_ORACLE_PROFILE
} from '../verification/OracleDecision.js';
import {
    DEFAULT_SEMGREP_PROFILE
} from '../verification/SemgrepProfile.js';
import {
    assertWorkbenchSessionInvariants
} from '../verification/VerificationInvariants.js';

type PersistableExperimentRun =
    StoredRunV2 |
    StoredRunV3 |
    StoredRunV4;

export class ArtifactPersistenceInvariantError
    extends Error {

    constructor(
        message: string,
        readonly invariant:
            string
    ) {
        super(message);

        this.name =
            'ArtifactPersistenceInvariantError';
    }
}

export const assertStoredRunV2PersistenceInvariants = (
    run: StoredRunV2
): void => {
    assertSchemaVersionV2(
        run
    );

    assertStoredRunPersistenceInvariants(
        run
    );

    assertNoNonFiniteNumbers(
        run,
        'artifact'
    );
};

export const assertStoredRunV3PersistenceInvariants = (
    run: StoredRunV3
): void => {
    assertSchemaVersionV3(
        run
    );

    assertStoredRunPersistenceInvariants(
        run
    );

    assertFixtureIssueSpecProvenance(
        run
    );

    assertNoNonFiniteNumbers(
        run,
        'artifact'
    );
};

export const assertStoredRunV4PersistenceInvariants = (
    run: StoredRunV4
): void => {
    assertSchemaVersionV4(run);

    assertStoredRunPersistenceInvariants(run);

    assertFixtureIssueSpecProvenance(run);

    assertTestSources(run);

    assertNoNonFiniteNumbers(
        run,
        'artifact'
    );
};

const assertSchemaVersionV4 = (
    run: StoredRunV4
): void => {
    if (run.schemaVersion !== 4) {
        throw new ArtifactPersistenceInvariantError(
            `Il Persistence Gate V4 accetta soltanto ` +
            `artifact schemaVersion 4.`,
            'SCHEMA_VERSION'
        );
    }
};

const assertTestSources = (
    run: StoredRunV4
): void => {
    assertSourceMap(
        run.testSources,
        'testSources',
        'TEST_SOURCES_TYPE',
        'TEST_SOURCE_PATH',
        'TEST_SOURCE_CONTENT'
    );

    assertSameFileSet(
        Object.keys(run.testSources),
        run.experimentProfile.fixture.testFiles,
        'TEST_SOURCES_FIXTURE_MISMATCH'
    );
};

const assertSourceMap = (
    sources: Readonly<Record<string, string>>,
    path: string,
    typeInvariant: string,
    pathInvariant: string,
    contentInvariant: string
): void => {
    if (
        typeof sources !== 'object' ||
        sources === null ||
        Array.isArray(sources)
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere una mappa file-contenuto.`,
            typeInvariant
        );
    }

    for (
        const [file, content]
        of Object.entries(sources)
    ) {
        assertNonEmptyString(
            file,
            `${path} key`
        );

        if (
            /[\u0000-\u001F\u007F]/.test(file)
        ) {
            throw new ArtifactPersistenceInvariantError(
                `Una chiave ${path} contiene ` +
                `un carattere di controllo.`,
                pathInvariant
            );
        }

        if (typeof content !== 'string') {
            throw new ArtifactPersistenceInvariantError(
                `Il contenuto di ${path}['${file}'] ` +
                `deve essere una stringa.`,
                contentInvariant
            );
        }
    }
};

const assertStoredRunPersistenceInvariants = (
    run: PersistableExperimentRun
): void => {
    assertNonEmptyString(
        run.metadata.runId,
        'metadata.runId'
    );

    assertNonEmptyString(
        run.metadata.taskId,
        'metadata.taskId'
    );

    assertNonEmptyString(
        run.session.taskId,
        'session.taskId'
    );

    assertNonEmptyString(
        run.modelConfig.baseUrl,
        'modelConfig.baseUrl'
    );

    assertNonEmptyString(
        run.modelConfig.modelName,
        'modelConfig.modelName'
    );

    try {
        assertWorkbenchSessionInvariants(
            run.session,
            DEFAULT_ORACLE_PROFILE
        );
    } catch (error: unknown) {
        throw new ArtifactPersistenceInvariantError(
            `Sessione non persistibile: ` +
            `${errorMessage(error)}`,
            'SESSION_INVARIANTS'
        );
    }

    assertRunIdentityConsistency(
        run
    );

    assertModelConfigInvariants(
        run.modelConfig
    );

    assertExperimentProfileInvariants(
        run.experimentProfile,
        run
    );

    assertMetadataConsistency(
        run.metadata,
        run.session,
        run.modelConfig
    );

    assertTelemetryInvariants(
        run.session.cumulativeTelemetry,
        'session.cumulativeTelemetry'
    );

    for (
        const [
            index,
            iteration
        ] of run.session.iterations.entries()
    ) {
        assertTelemetryInvariants(
            iteration.telemetry,
            `session.iterations[${index}].telemetry`
        );

        if (
            iteration.agentUsage !==
            undefined
        ) {
            assertAgentUsageInvariants(
                iteration.agentUsage.CODER,
                `session.iterations[${index}]` +
                `.agentUsage.CODER`
            );

            assertAgentUsageInvariants(
                iteration.agentUsage.REVIEWER,
                `session.iterations[${index}]` +
                `.agentUsage.REVIEWER`
            );
        }
    }

    assertTargetSources(
        run.targetSources
    );
};

const assertSchemaVersionV2 = (
    run: StoredRunV2
): void => {
    if (
        run.schemaVersion !== 2
    ) {
        throw new ArtifactPersistenceInvariantError(
            `Il Persistence Gate V2 accetta soltanto ` +
            `artifact schemaVersion 2.`,
            'SCHEMA_VERSION'
        );
    }
};

const assertSchemaVersionV3 = (
    run: StoredRunV3
): void => {
    if (
        run.schemaVersion !== 3
    ) {
        throw new ArtifactPersistenceInvariantError(
            `Il Persistence Gate V3 accetta soltanto ` +
            `artifact schemaVersion 3.`,
            'SCHEMA_VERSION'
        );
    }
};

const assertRunIdentityConsistency = (
    run: PersistableExperimentRun
): void => {
    if (
        run.session.runId === undefined
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.runId deve essere presente ` +
            `prima della persistenza.`,
            'SESSION_RUN_ID_REQUIRED'
        );
    }

    if (
        run.metadata.runId !==
        run.session.runId
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.runId e session.runId ` +
            `devono coincidere.`,
            'RUN_ID_MISMATCH'
        );
    }

    if (
        run.metadata.taskId !==
        run.session.taskId
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.taskId e session.taskId ` +
            `devono coincidere.`,
            'TASK_ID_MISMATCH'
        );
    }

    if (
        run.metadata.category !==
        run.session.category
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.category e session.category ` +
            `devono coincidere.`,
            'CATEGORY_MISMATCH'
        );
    }

    if (
        run.metadata.status !==
        run.session.status
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.status e session.status ` +
            `devono coincidere.`,
            'STATUS_MISMATCH'
        );
    }
};

const assertModelConfigInvariants = (
    modelConfig:
        ExperimentModelConfig
): void => {
    assertFiniteNumber(
        modelConfig.seed,
        'modelConfig.seed'
    );

    if (
        !Number.isInteger(
            modelConfig.seed
        ) ||
        modelConfig.seed < 0
    ) {
        throw new ArtifactPersistenceInvariantError(
            `modelConfig.seed deve essere ` +
            `un intero non negativo.`,
            'MODEL_SEED'
        );
    }

    assertFiniteNumber(
        modelConfig.temperature,
        'modelConfig.temperature'
    );

    if (
        modelConfig.temperature < 0 ||
        modelConfig.temperature > 2
    ) {
        throw new ArtifactPersistenceInvariantError(
            `modelConfig.temperature deve ` +
            `essere compresa tra 0 e 2.`,
            'MODEL_TEMPERATURE'
        );
    }

    assertFiniteNumber(
        modelConfig.topP,
        'modelConfig.topP'
    );

    if (
        modelConfig.topP <= 0 ||
        modelConfig.topP > 1
    ) {
        throw new ArtifactPersistenceInvariantError(
            `modelConfig.topP deve essere ` +
            `maggiore di 0 e minore o uguale a 1.`,
            'MODEL_TOP_P'
        );
    }

    assertFiniteNumber(
        modelConfig.inferenceTimeoutMs,
        'modelConfig.inferenceTimeoutMs'
    );

    if (
        !Number.isInteger(
            modelConfig.inferenceTimeoutMs
        ) ||
        modelConfig.inferenceTimeoutMs <
        1_000 ||
        modelConfig.inferenceTimeoutMs >
        600_000
    ) {
        throw new ArtifactPersistenceInvariantError(
            `modelConfig.inferenceTimeoutMs ` +
            `deve essere un intero compreso ` +
            `tra 1.000 e 600.000 ms.`,
            'INFERENCE_TIMEOUT'
        );
    }
};

const assertExperimentProfileInvariants = (
    profile: ExperimentProfile,
    run: PersistableExperimentRun
): void => {
    if (
        typeof profile !== 'object' ||
        profile === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile deve essere un oggetto.`,
            'EXPERIMENT_PROFILE_REQUIRED'
        );
    }

    if (
        typeof profile.limits !== 'object' ||
        profile.limits === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.limits deve essere presente.`,
            'EXPERIMENT_LIMITS_REQUIRED'
        );
    }

    if (
        typeof profile.fixture !== 'object' ||
        profile.fixture === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.fixture deve essere presente.`,
            'EXPERIMENT_FIXTURE_REQUIRED'
        );
    }

    assertNonEmptyString(
        profile.oracleProfileId,
        'experimentProfile.oracleProfileId'
    );

    if (
        profile.oracleProfileId !==
        DEFAULT_ORACLE_PROFILE.id
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.oracleProfileId non corrisponde ` +
            `al profilo Oracle utilizzato dal framework.`,
            'ORACLE_PROFILE_MISMATCH'
        );
    }

    assertNonEmptyString(
        profile.promptProfileId,
        'experimentProfile.promptProfileId'
    );

    if (
        profile.promptProfileId !==
        DEFAULT_PROMPT_PROFILE.id
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.promptProfileId non corrisponde al profilo prompt utilizzato dal framework.`,
            'PROMPT_PROFILE_MISMATCH'
        );
    }

    assertNonEmptyString(
        profile.semgrepProfileId,
        'experimentProfile.semgrepProfileId'
    );

    if (
        profile.semgrepProfileId !==
        DEFAULT_SEMGREP_PROFILE.id
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.semgrepProfileId non corrisponde ` +
            `al profilo Semgrep utilizzato dal framework.`,
            'SEMGREP_PROFILE_MISMATCH'
        );
    }

    if (
        typeof profile.modelConfig !== 'object' ||
        profile.modelConfig === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.modelConfig deve essere presente.`,
            'PROFILE_MODEL_CONFIG_REQUIRED'
        );
    }

    if (
        typeof profile.buildOracleConfig !== 'object' ||
        profile.buildOracleConfig === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.buildOracleConfig deve essere presente.`,
            'BUILD_ORACLE_CONFIG_REQUIRED'
        );
    }

    if (
        typeof profile.functionalTestOracleConfig !== 'object' ||
        profile.functionalTestOracleConfig === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.functionalTestOracleConfig deve essere presente.`,
            'FUNCTIONAL_TEST_CONFIG_REQUIRED'
        );
    }

    if (
        typeof profile.functionalTestOracleConfig
            .expectedExitPolicy !== 'object' ||
        profile.functionalTestOracleConfig
            .expectedExitPolicy === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `functionalTestOracleConfig.expectedExitPolicy ` +
            `deve essere presente.`,
            'EXPECTED_EXIT_POLICY_REQUIRED'
        );
    }

    if (
        typeof profile.semgrepConfig !== 'object' ||
        profile.semgrepConfig === null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.semgrepConfig deve essere presente.`,
            'SEMGREP_CONFIG_REQUIRED'
        );
    }

    assertProfileModelConfigConsistency(
        profile.modelConfig,
        run.modelConfig
    );

    assertExecutionConfig(
        profile.buildOracleConfig,
        'experimentProfile.buildOracleConfig'
    );

    assertExecutionConfig(
        profile.functionalTestOracleConfig,
        'experimentProfile.functionalTestOracleConfig'
    );

    assertExecutionConfig(
        profile.semgrepConfig,
        'experimentProfile.semgrepConfig'
    );

    assertStringArray(
        profile.buildOracleConfig.args,
        'experimentProfile.buildOracleConfig.args'
    );

    if (
        profile.buildOracleConfig.cwd !==
        undefined
    ) {
        assertNonEmptyString(
            profile.buildOracleConfig.cwd,
            'experimentProfile.buildOracleConfig.cwd'
        );
    }

    assertStringArray(
        profile.functionalTestOracleConfig.args,
        'experimentProfile.functionalTestOracleConfig.args'
    );

    assertNonEmptyString(
        profile.functionalTestOracleConfig.cwd,
        'experimentProfile.functionalTestOracleConfig.cwd'
    );

    assertStringArray(
        profile.functionalTestOracleConfig.oracleFiles,
        'experimentProfile.functionalTestOracleConfig.oracleFiles'
    );

    if (
        typeof profile.functionalTestOracleConfig
            .allowImplicitDiscovery !== 'boolean'
    ) {
        throw new ArtifactPersistenceInvariantError(
            `functionalTestOracleConfig.allowImplicitDiscovery ` +
            `deve essere boolean.`,
            'FUNCTIONAL_IMPLICIT_DISCOVERY'
        );
    }

    assertExitCodeArray(
        profile.functionalTestOracleConfig
            .expectedExitPolicy.passExitCodes,
        'expectedExitPolicy.passExitCodes'
    );

    assertExitCodeArray(
        profile.functionalTestOracleConfig
            .expectedExitPolicy.failExitCodes,
        'expectedExitPolicy.failExitCodes'
    );

    assertExitCodeArray(
        profile.functionalTestOracleConfig
            .expectedExitPolicy.executionErrorExitCodes,
        'expectedExitPolicy.executionErrorExitCodes',
        true
    );

    const allExitCodes = [
        ...profile.functionalTestOracleConfig
            .expectedExitPolicy.passExitCodes,

        ...profile.functionalTestOracleConfig
            .expectedExitPolicy.failExitCodes,

        ...profile.functionalTestOracleConfig
            .expectedExitPolicy.executionErrorExitCodes
    ];

    if (
        new Set(allExitCodes).size !==
        allExitCodes.length
    ) {
        throw new ArtifactPersistenceInvariantError(
            `Le classi pass, fail ed execution error ` +
            `della expectedExitPolicy non possono sovrapporsi.`,
            'EXIT_CODE_POLICY_OVERLAP'
        );
    }

    assertPositiveInteger(
        profile.limits.maxIterations,
        'experimentProfile.limits.maxIterations'
    );

    assertPositiveInteger(
        profile.limits.maxTechnicalAttempts,
        'experimentProfile.limits.maxTechnicalAttempts'
    );

    if (
        profile.limits.maxIterations !==
        run.session.maxIterations
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.limits.maxIterations deve coincidere con session.maxIterations.`,
            'MAX_ITERATIONS_MISMATCH'
        );
    }
    for (
        const [
            index,
            iteration
        ] of run.session.iterations.entries()
    ) {
        if (iteration.technicalAttempts !== undefined) {
            if (!Number.isInteger(iteration.technicalAttempts) || iteration.technicalAttempts <= 0) {
                throw new ArtifactPersistenceInvariantError(
                    `session.iterations[${index}].technicalAttempts deve essere un intero positivo.`,
                    'INVALID_TECHNICAL_ATTEMPTS'
                );
            }
            if (iteration.technicalAttempts > profile.limits.maxTechnicalAttempts) {
                throw new ArtifactPersistenceInvariantError(
                    `session.iterations[${index}].technicalAttempts supera il limite dichiarato nel profilo sperimentale.`,
                    'MAX_TECHNICAL_ATTEMPTS_EXCEEDED'
                );
            }
        }
    }

    assertFixtureIdentity(
        profile,
        run
    );
};

const assertProfileModelConfigConsistency = (
    profileModelConfig: ExperimentModelConfig,
    storedModelConfig: ExperimentModelConfig
): void => {
    assertModelConfigInvariants(
        profileModelConfig
    );

    const sameConfig =
        profileModelConfig.baseUrl === storedModelConfig.baseUrl &&
        profileModelConfig.modelName === storedModelConfig.modelName &&
        profileModelConfig.seed === storedModelConfig.seed &&
        profileModelConfig.temperature === storedModelConfig.temperature &&
        profileModelConfig.topP === storedModelConfig.topP &&
        profileModelConfig.inferenceTimeoutMs ===
        storedModelConfig.inferenceTimeoutMs;

    if (!sameConfig) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.modelConfig deve coincidere ` +
            `con modelConfig dell'artifact.`,
            'PROFILE_MODEL_CONFIG_MISMATCH'
        );
    }
};

const assertExecutionConfig = (
    config: {
        readonly command: string;
        readonly timeoutMs: number;
        readonly envAllowList: readonly string[];
    },
    path: string
): void => {
    assertNonEmptyString(
        config.command,
        `${path}.command`
    );

    assertPositiveInteger(
        config.timeoutMs,
        `${path}.timeoutMs`
    );

    if (!Array.isArray(config.envAllowList)) {
        throw new ArtifactPersistenceInvariantError(
            `${path}.envAllowList deve essere un array.`,
            'ENV_ALLOW_LIST'
        );
    }

    for (
        const [
            index,
            variable
        ] of config.envAllowList.entries()
    ) {
        assertNonEmptyString(
            variable,
            `${path}.envAllowList[${index}]`
        );
    }

    if (
        new Set(config.envAllowList).size !==
        config.envAllowList.length
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path}.envAllowList contiene duplicati.`,
            'ENV_ALLOW_LIST_DUPLICATES'
        );
    }
};

const assertFixtureIdentity = (
    profile: ExperimentProfile,
    run: PersistableExperimentRun
): void => {
    const fixture =
        profile.fixture;

    if (
        !/^[a-f0-9]{64}$/i.test(
            fixture.id
        )
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.fixture.id deve essere ` +
            `un digest SHA-256 esadecimale.`,
            'FIXTURE_ID_FORMAT'
        );
    }

    if (
        fixture.taskId !==
        run.session.taskId
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.fixture.taskId deve ` +
            `coincidere con session.taskId.`,
            'FIXTURE_TASK_ID_MISMATCH'
        );
    }

    if (
        fixture.category !==
        run.session.category
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.fixture.category deve ` +
            `coincidere con session.category.`,
            'FIXTURE_CATEGORY_MISMATCH'
        );
    }

    assertSameFileSet(
        fixture.targetFiles,
        run.session.targetFiles,
        'FIXTURE_TARGET_FILES_MISMATCH'
    );

    assertSameFileSet(
        fixture.testFiles,
        run.session.testFiles,
        'FIXTURE_TEST_FILES_MISMATCH'
    );

    assertSameFileSet(
        Object.keys(run.targetSources),
        fixture.targetFiles,
        'TARGET_SOURCES_FIXTURE_MISMATCH'
    );
};

const assertFixtureIssueSpecProvenance = (
    run: StoredRunV3 | StoredRunV4
): void => {
    const fixture =
        run.experimentProfile.fixture;

    assertNonEmptyString(
        fixture.issueSpec,
        'experimentProfile.fixture.issueSpec'
    );

    if (
        fixture.issueSpec !==
        run.session.issueSpec
    ) {
        throw new ArtifactPersistenceInvariantError(
            `experimentProfile.fixture.issueSpec deve ` +
            `coincidere esattamente con session.issueSpec.`,
            'FIXTURE_ISSUE_SPEC_MISMATCH'
        );
    }
};

const assertSameFileSet = (
    actual: readonly string[],
    expected: readonly string[],
    invariant: string
): void => {
    const normalize = (
        values: readonly string[]
    ): string[] =>
        [...values]
            .map((value) =>
                value.replaceAll('\\', '/')
            )
            .sort((left, right) =>
                left.localeCompare(right)
            );

    if (
        JSON.stringify(normalize(actual)) !==
        JSON.stringify(normalize(expected))
    ) {
        throw new ArtifactPersistenceInvariantError(
            `Gli insiemi di file della fixture non coincidono.`,
            invariant
        );
    }
};

const assertPositiveInteger = (
    value: number,
    path: string
): void => {
    if (
        !Number.isInteger(value) ||
        value <= 0
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere un intero positivo.`,
            'POSITIVE_INTEGER'
        );
    }
};

const assertStringArray = (
    values: readonly string[],
    path: string
): void => {
    if (!Array.isArray(values)) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere un array.`,
            'STRING_ARRAY'
        );
    }

    for (
        const [
            index,
            value
        ] of values.entries()
    ) {
        assertNonEmptyString(
            value,
            `${path}[${index}]`
        );
    }
};

const assertExitCodeArray = (
    values: readonly number[],
    path: string,
    allowEmpty = false
): void => {
    if (
        !Array.isArray(values) ||
        (!allowEmpty && values.length === 0)
    ) {
        throw new ArtifactPersistenceInvariantError(
            allowEmpty
                ? `${path} deve essere un array di exit code.`
                : `${path} deve contenere almeno un exit code.`,
            'EXIT_CODE_ARRAY'
        );
    }

    for (
        const [
            index,
            value
        ] of values.entries()
    ) {
        assertNonNegativeInteger(
            value,
            `${path}[${index}]`
        );
    }

    if (
        new Set(values).size !==
        values.length
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} contiene exit code duplicati.`,
            'EXIT_CODE_DUPLICATES'
        );
    }
};

const assertMetadataConsistency = (
    metadata: ExperimentMetadata,
    session: WorkbenchSessionState,
    modelConfig: ExperimentModelConfig
): void => {
    if (metadata.apiBaseUrl !== modelConfig.baseUrl) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.apiBaseUrl non corrisponde ` +
            `a modelConfig.baseUrl.`,
            'MODEL_BASE_URL_MISMATCH'
        );
    }

    if (
        metadata.modelName !==
        modelConfig.modelName
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.modelName non corrisponde ` +
            `a modelConfig.modelName.`,
            'MODEL_NAME_MISMATCH'
        );
    }

    if (
        metadata.seed !==
        modelConfig.seed
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.seed non corrisponde ` +
            `a modelConfig.seed.`,
            'MODEL_SEED_MISMATCH'
        );
    }

    if (
        metadata.temperature !==
        modelConfig.temperature
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.temperature non corrisponde ` +
            `a modelConfig.temperature.`,
            'MODEL_TEMPERATURE_MISMATCH'
        );
    }

    if (
        metadata.topP !==
        modelConfig.topP
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.topP non corrisponde ` +
            `a modelConfig.topP.`,
            'MODEL_TOP_P_MISMATCH'
        );
    }

    if (
        metadata.inferenceTimeoutMs !==
        modelConfig.inferenceTimeoutMs
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.inferenceTimeoutMs non ` +
            `corrisponde alla configurazione ` +
            `effettiva del modello.`,
            'MODEL_TIMEOUT_MISMATCH'
        );
    }

    if (
        session.autonomousStatus === undefined
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.autonomousStatus deve essere presente ` +
            `per un artifact persistibile.`,
            'AUTONOMOUS_STATUS_REQUIRED'
        );
    }

    if (
        metadata.autonomousStatus !==
        session.autonomousStatus
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.autonomousStatus e ` +
            `session.autonomousStatus devono coincidere.`,
            'AUTONOMOUS_STATUS_MISMATCH'
        );
    }

    if (
        metadata.status !==
        session.autonomousStatus
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.status deve preservare ` +
            `l'outcome autonomo della sessione.`,
            'LEGACY_STATUS_AUTONOMOUS_MISMATCH'
        );
    }
    if (
        metadata.finalizationStatus !==
        session.finalizationStatus
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.finalizationStatus e ` +
            `session.finalizationStatus devono coincidere.`,
            'FINALIZATION_STATUS_MISMATCH'
        );
    }

    if (
        metadata.candidateVerified !==
        session.candidateVerified
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.candidateVerified e ` +
            `session.candidateVerified devono coincidere.`,
            'CANDIDATE_VERIFIED_MISMATCH'
        );
    }

    if (
        metadata.autonomousRunSucceeded !==
        session.autonomousRunSucceeded
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.autonomousRunSucceeded e ` +
            `session.autonomousRunSucceeded devono coincidere.`,
            'AUTONOMOUS_RUN_SUCCESS_MISMATCH'
        );
    }

    if (
        metadata.totalIterations !==
        session.currentIteration
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.totalIterations deve ` +
            `coincidere con session.currentIteration.`,
            'ITERATION_COUNT_MISMATCH'
        );
    }

    if (
        session.currentIteration !==
        session.iterations.length
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.currentIteration deve ` +
            `coincidere con il numero di iterazioni ` +
            `persistite.`,
            'SESSION_ITERATION_COUNT_MISMATCH'
        );
    }

    if (
        session.currentIteration >
        session.maxIterations
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.currentIteration non può ` +
            `superare session.maxIterations.`,
            'MAX_ITERATIONS_EXCEEDED'
        );
    }

    const finalVerification =
        session.iterations
            .at(-1)
            ?.verification;

    const expectedCandidateVerified =
        finalVerification?.verified === true;

    if (
        session.candidateVerified !==
        expectedCandidateVerified
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.candidateVerified non corrisponde ` +
            `al verdetto dell'ultima candidata.`,
            'CANDIDATE_VERIFICATION_MISMATCH'
        );
    }

    const expectedAutonomousRunSucceeded =
        session.autonomousStatus === 'CONVERGED' &&
        session.candidateVerified;

    if (
        session.autonomousRunSucceeded !==
        expectedAutonomousRunSucceeded
    ) {
        throw new ArtifactPersistenceInvariantError(
            `session.autonomousRunSucceeded non è coerente ` +
            `con candidateVerified e autonomousStatus.`,
            'AUTONOMOUS_RUN_SUCCESS_INCONSISTENT'
        );
    }

    const expectedResolutionVerified =
        session.autonomousRunSucceeded;

    if (
        metadata.resolutionVerified !==
        expectedResolutionVerified
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.resolutionVerified non ` +
            `corrisponde al successo autonomo ` +
            `complessivo del run.`,
            'RESOLUTION_MISMATCH'
        );
    }
    if (
        metadata.isHumanAugmented &&
        metadata.finalizationStatus !== 'APPROVED'
    ) {
        throw new ArtifactPersistenceInvariantError(
            `isHumanAugmented può essere true soltanto ` +
            `per una finalizzazione APPROVED.`,
            'HUMAN_AUGMENTATION_FINALIZATION_MISMATCH'
        );
    }

    const telemetry =
        session.cumulativeTelemetry;

    const expectedTotalTokens =
        computeTotalTokens(
            telemetry.promptTokens,
            telemetry.completionTokens,
            telemetry.tokenUsageAvailable
        );

    if (
        metadata.totalTokens !==
        expectedTotalTokens
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.totalTokens non è coerente ` +
            `con la telemetria cumulativa.`,
            'TOTAL_TOKENS_MISMATCH'
        );
    }

    if (
        metadata.tokenUsageAvailable !==
        telemetry.tokenUsageAvailable
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.tokenUsageAvailable non ` +
            `corrisponde alla telemetria cumulativa.`,
            'TOKEN_AVAILABILITY_MISMATCH'
        );
    }

    assertEqualFiniteNumber(
        metadata.totalDurationMs,
        telemetry.totalDurationMs,
        'metadata.totalDurationMs',
        'TOTAL_DURATION_MISMATCH'
    );

    assertEqualFiniteNumber(
        metadata.inferenceDurationMs,
        telemetry.inferenceDurationMs,
        'metadata.inferenceDurationMs',
        'INFERENCE_DURATION_MISMATCH'
    );

    if (
        metadata.oracleDurationMs !==
        telemetry.oracleDurationMs
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.oracleDurationMs non corrisponde ` +
            `alla telemetria cumulativa.`,
            'ORACLE_DURATION_MISMATCH'
        );
    }


    assertEqualFiniteNumber(
        metadata.orchestrationOverheadMs,
        telemetry.orchestrationOverheadMs,
        'metadata.orchestrationOverheadMs',
        'ORCHESTRATION_CPU_MISMATCH'
    );

    if (
        metadata.orchestrationOverheadBasis !==
        'NODE_PROCESS_CPU'
    ) {
        throw new ArtifactPersistenceInvariantError(
            `orchestrationOverheadBasis deve ` +
            `essere NODE_PROCESS_CPU.`,
            'ORCHESTRATION_BASIS'
        );
    }

    const expectedHumanAugmented =
        session.isHumanAugmented ??
        false;

    if (
        metadata.isHumanAugmented !==
        expectedHumanAugmented
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.isHumanAugmented non ` +
            `corrisponde alla sessione.`,
            'HUMAN_AUGMENTATION_MISMATCH'
        );
    }

    assertTimestamp(
        metadata.timestamp
    );
};

const assertTelemetryInvariants = (
    telemetry:
        ComputationalTelemetry,

    path:
        string
): void => {
    assertTokenPair(
        telemetry.promptTokens,
        telemetry.completionTokens,
        telemetry.tokenUsageAvailable,
        path
    );

    assertNonNegativeFiniteNumber(
        telemetry.inferenceDurationMs,
        `${path}.inferenceDurationMs`
    );

    assertOracleDuration(
        telemetry.oracleDurationMs,
        telemetry.oracleDurationAvailable,
        path
    );

    assertNonNegativeFiniteNumber(
        telemetry.orchestrationOverheadMs,
        `${path}.orchestrationOverheadMs`
    );

    assertNonNegativeFiniteNumber(
        telemetry.totalDurationMs,
        `${path}.totalDurationMs`
    );

    assertAgentUsageInvariants(
        telemetry.agentUsage.CODER,
        `${path}.agentUsage.CODER`
    );

    assertAgentUsageInvariants(
        telemetry.agentUsage.REVIEWER,
        `${path}.agentUsage.REVIEWER`
    );

    if (
        telemetry.tokenUsageAvailable
    ) {
        const coder =
            telemetry.agentUsage.CODER;

        const reviewer =
            telemetry.agentUsage.REVIEWER;

        if (
            !coder.tokenUsageAvailable ||
            !reviewer.tokenUsageAvailable
        ) {
            throw new ArtifactPersistenceInvariantError(
                `${path}.tokenUsageAvailable non ` +
                `può essere true se l'usage di un ` +
                `agente è indisponibile.`,
                'AGENT_TOKEN_AVAILABILITY_MISMATCH'
            );
        }

        const expectedPromptTokens =
            (coder.promptTokens ?? 0) +
            (reviewer.promptTokens ?? 0);

        const expectedCompletionTokens =
            (coder.completionTokens ?? 0) +
            (reviewer.completionTokens ?? 0);

        if (
            telemetry.promptTokens !==
            expectedPromptTokens ||
            telemetry.completionTokens !==
            expectedCompletionTokens
        ) {
            throw new ArtifactPersistenceInvariantError(
                `${path} non coincide con la somma ` +
                `dei token per agente.`,
                'AGENT_TOKEN_SUM_MISMATCH'
            );
        }
    }
};

const assertOracleDuration = (
    oracleDurationMs:
        number | null,

    oracleDurationAvailable:
        boolean,

    path:
        string
): void => {
    if (
        typeof oracleDurationAvailable !==
        'boolean'
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path}.oracleDurationAvailable deve essere boolean.`,
            'ORACLE_DURATION_AVAILABILITY_TYPE'
        );
    }

    if (
        oracleDurationAvailable
    ) {
        if (
            oracleDurationMs === null
        ) {
            throw new ArtifactPersistenceInvariantError(
                `${path}.oracleDurationMs deve essere presente ` +
                `quando oracleDurationAvailable è true.`,
                'ORACLE_DURATION_REQUIRED'
            );
        }

        assertNonNegativeFiniteNumber(
            oracleDurationMs,
            `${path}.oracleDurationMs`
        );

        return;
    }

    if (
        oracleDurationMs !== null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path}.oracleDurationMs deve essere null ` +
            `quando oracleDurationAvailable è false.`,
            'UNAVAILABLE_ORACLE_DURATION_MUST_BE_NULL'
        );
    }
};

const assertAgentUsageInvariants = (
    usage:
        AgentUsage,

    path:
        string
): void => {
    assertTokenPair(
        usage.promptTokens,
        usage.completionTokens,
        usage.tokenUsageAvailable,
        path
    );

    assertNonNegativeFiniteNumber(
        usage.inferenceDurationMs,
        `${path}.inferenceDurationMs`
    );
};

const assertTokenPair = (
    promptTokens:
        number | null,

    completionTokens:
        number | null,

    tokenUsageAvailable:
        boolean,

    path:
        string
): void => {
    if (
        typeof tokenUsageAvailable !==
        'boolean'
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path}.tokenUsageAvailable ` +
            `deve essere boolean.`,
            'TOKEN_AVAILABILITY_TYPE'
        );
    }

    if (tokenUsageAvailable) {
        if (
            typeof promptTokens !== 'number' ||
            typeof completionTokens !== 'number'
        ) {
            throw new ArtifactPersistenceInvariantError(
                `${path} dichiara token disponibili, ` +
                `ma almeno un conteggio è null.`,
                'TOKEN_VALUES_REQUIRED'
            );
        }

        assertNonNegativeInteger(
            promptTokens,
            `${path}.promptTokens`
        );

        assertNonNegativeInteger(
            completionTokens,
            `${path}.completionTokens`
        );

        return;
    }

    if (
        promptTokens !== null ||
        completionTokens !== null
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} dichiara token non disponibili, ` +
            `quindi entrambi i conteggi devono ` +
            `essere null.`,
            'UNAVAILABLE_TOKENS_MUST_BE_NULL'
        );
    }
};

const assertTargetSources = (
    targetSources:
        Readonly<Record<string, string>>
): void => {
    assertSourceMap(
        targetSources,
        'targetSources',
        'TARGET_SOURCES_TYPE',
        'TARGET_SOURCE_PATH',
        'TARGET_SOURCE_CONTENT'
    );
};

const computeTotalTokens = (
    promptTokens:
        number | null,

    completionTokens:
        number | null,

    tokenUsageAvailable:
        boolean
): number | null => {
    if (
        !tokenUsageAvailable ||
        promptTokens === null ||
        completionTokens === null
    ) {
        return null;
    }

    return (
        promptTokens +
        completionTokens
    );
};

const assertEqualFiniteNumber = (
    actual:
        number,

    expected:
        number,

    path:
        string,

    invariant:
        string
): void => {
    assertNonNegativeFiniteNumber(
        actual,
        path
    );

    assertNonNegativeFiniteNumber(
        expected,
        `${path}.expected`
    );

    if (actual !== expected) {
        throw new ArtifactPersistenceInvariantError(
            `${path} non corrisponde ` +
            `alla telemetria della sessione.`,
            invariant
        );
    }
};

const assertNonNegativeInteger = (
    value:
        number,

    path:
        string
): void => {
    if (
        !Number.isInteger(value) ||
        value < 0
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere un intero ` +
            `non negativo.`,
            'NON_NEGATIVE_INTEGER'
        );
    }
};

const assertFiniteNumber = (
    value:
        number,

    path:
        string
): void => {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value)
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere un numero finito.`,
            'FINITE_NUMBER'
        );
    }
};

const assertNonNegativeFiniteNumber = (
    value:
        number,

    path:
        string
): void => {
    assertFiniteNumber(
        value,
        path
    );

    if (value < 0) {
        throw new ArtifactPersistenceInvariantError(
            `${path} non può essere negativo.`,
            'NON_NEGATIVE_NUMBER'
        );
    }
};

const assertNonEmptyString = (
    value:
        string,

    path:
        string
): void => {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0
    ) {
        throw new ArtifactPersistenceInvariantError(
            `${path} deve essere una stringa ` +
            `non vuota.`,
            'NON_EMPTY_STRING'
        );
    }
};

const assertTimestamp = (
    value:
        string
): void => {
    assertNonEmptyString(
        value,
        'metadata.timestamp'
    );

    const parsed =
        Date.parse(value);

    if (
        !Number.isFinite(parsed)
    ) {
        throw new ArtifactPersistenceInvariantError(
            `metadata.timestamp non è ` +
            `una data valida.`,
            'TIMESTAMP'
        );
    }
};

const assertNoNonFiniteNumbers = (
    value:
        unknown,

    path:
        string
): void => {
    if (
        typeof value === 'number'
    ) {
        if (!Number.isFinite(value)) {
            throw new ArtifactPersistenceInvariantError(
                `${path} contiene un numero non finito.`,
                'NON_FINITE_VALUE'
            );
        }

        return;
    }

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return;
    }

    if (Array.isArray(value)) {
        value.forEach(
            (
                item,
                index
            ) => {
                assertNoNonFiniteNumbers(
                    item,
                    `${path}[${index}]`
                );
            }
        );

        return;
    }

    for (
        const [
            key,
            nestedValue
        ] of Object.entries(
            value
        )
    ) {
        assertNoNonFiniteNumbers(
            nestedValue,
            `${path}.${key}`
        );
    }
};

const errorMessage = (
    error:
        unknown
): string =>
    error instanceof Error
        ? error.message
        : String(error);
