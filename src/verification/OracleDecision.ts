import type {
    OracleName,
    OracleProfile,
    OracleResult,
} from "../types/domain.js";

export const DEFAULT_ORACLE_PROFILE: OracleProfile = Object.freeze({
    id: "FULL_VERIFICATION_V1",

    requirements: Object.freeze({
        APPLICABILITY: "REQUIRED",
        BUILD_SYNTAX: "REQUIRED",
        SEMGREP: "REQUIRED",
        FUNCTIONAL_TEST: "REQUIRED",
    }),
});

export interface OracleDecision {
    readonly converged: boolean;
    readonly shouldRefine: boolean;
    readonly hasExecutionError: boolean;
    readonly hasRequiredUnavailable: boolean;
    readonly hasInvariantViolation: boolean;
    readonly failedResults: readonly OracleResult[];
    readonly executionErrors: readonly OracleResult[];
    readonly requiredUnavailable: readonly OracleResult[];
    readonly missingRequiredOracles: readonly OracleName[];
    readonly duplicateOracles: readonly OracleName[];
    readonly requirementMismatches: readonly OracleName[];
    readonly blockedResults: readonly OracleResult[];
    readonly hasBlockedResults: boolean;
}

export function decideOracleResults(
    oracleResults: readonly OracleResult[],
    profile: OracleProfile = DEFAULT_ORACLE_PROFILE,
): OracleDecision {
    const resultsByOracle = new Map<OracleName, OracleResult[]>();

    for (const result of oracleResults) {
        const existing = resultsByOracle.get(result.oracle) ?? [];

        existing.push(result);

        resultsByOracle.set(result.oracle, existing);
    }

    const oracleNames = Object.keys(profile.requirements) as OracleName[];

    const requiredOracleNames = oracleNames.filter(
        (oracle) => profile.requirements[oracle] === "REQUIRED",
    );

    const missingRequiredOracles = requiredOracleNames.filter(
        (oracle) => (resultsByOracle.get(oracle)?.length ?? 0) === 0,
    );

    const duplicateOracles = oracleNames.filter(
        (oracle) => (resultsByOracle.get(oracle)?.length ?? 0) > 1,
    );

    const requirementMismatches = oracleResults
        .filter((result) => {
            const expectedRequired =
                profile.requirements[result.oracle] === "REQUIRED";

            return result.required !== expectedRequired;
        })
        .map((result) => result.oracle)
        .filter((oracle, index, values) => values.indexOf(oracle) === index);

    const requiredResults = requiredOracleNames.flatMap(
        (oracle) => resultsByOracle.get(oracle) ?? [],
    );

    const failedResults = requiredResults.filter(
        (result) => result.status === "FAIL",
    );

    const executionErrors = requiredResults.filter(
        (result) => result.status === "EXECUTION_ERROR",
    );

    const requiredUnavailable = requiredResults.filter(
        (result) => result.status === "NOT_AVAILABLE",
    );

    const blockedResults =
        requiredResults.filter(
            (result) =>
                result.status === 'BLOCKED'
        );

    const hasBlockedResults =
        blockedResults.length > 0;

    const hasInvariantViolation =
        missingRequiredOracles.length > 0 ||
        duplicateOracles.length > 0 ||
        requirementMismatches.length > 0;

    const hasExecutionError = executionErrors.length > 0;

    const hasRequiredUnavailable = requiredUnavailable.length > 0;

    const allRequiredPassed =
        requiredOracleNames.length > 0 &&
        requiredOracleNames.every((oracle) => {
            const results = resultsByOracle.get(oracle) ?? [];

            return (
                results.length === 1 &&
                results[0]?.status === "PASS" &&
                results[0]?.required === true
            );
        });

    const converged =
        !hasInvariantViolation &&
        !hasExecutionError &&
        !hasRequiredUnavailable &&
        failedResults.length === 0 &&
        allRequiredPassed;

    const shouldRefine =
        !hasInvariantViolation &&
        !hasExecutionError &&
        !hasRequiredUnavailable &&
        failedResults.length > 0 &&
        requiredResults.every(
            (result) =>
                result.status === 'PASS' ||
                result.status === 'FAIL' ||
                result.status === 'BLOCKED'
        );

    return {
        converged,
        shouldRefine,
        hasExecutionError,
        hasRequiredUnavailable,
        hasInvariantViolation,
        failedResults,
        executionErrors,
        requiredUnavailable,
        missingRequiredOracles,
        duplicateOracles,
        requirementMismatches,
        blockedResults,
        hasBlockedResults,
    };
}
