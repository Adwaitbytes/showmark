import type { CheckInProblem } from "./errors";
import { localizedError, type Copy, type Dictionary, type ErrorTables } from "./i18n";

/**
 * The words for a check-in problem. Temporary trouble gets the app's own framing ("your check-in
 * is saved on this phone"), because that is what the person needs to know; final answers from the
 * relay use the API's message and action, translated when the language is Hindi.
 */
export function problemCopy(problem: CheckInProblem, t: Dictionary, errors: ErrorTables | null): Copy {
  switch (problem.kind) {
    case "offline":
      return t.errors.offline;
    case "relay":
    case "rate":
      return problem.kind === "rate" && problem.message && problem.action
        ? localizedError(problem.code, { message: problem.message, action: problem.action }, errors?.api ?? null)
        : t.errors.relay;
    case "reverted":
      return t.errors.reverted;
    case "unconfirmed":
      return t.errors.confirmTimeout;
    case "invalid":
      return t.errors.invalidCode;
    case "storage":
      return t.errors.storage;
    default: {
      const english = problem.message && problem.action ? { message: problem.message, action: problem.action } : t.errors.unknown;
      return localizedError(problem.code, english, errors?.api ?? null);
    }
  }
}
