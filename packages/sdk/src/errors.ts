// Every error the SDK throws is a ShowmarkError, so callers can branch on `code` instead of parsing messages.

export type ShowmarkErrorCode =
  | "CONFIG"
  | "INVALID_INPUT"
  | "SIGNING"
  | "NETWORK"
  | "RELAY"
  | "CONTRACT";

export class ShowmarkError extends Error {
  readonly code: ShowmarkErrorCode;

  constructor(code: ShowmarkErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ShowmarkError";
    this.code = code;
  }
}

/** The client is missing something it needs, such as a contract address or a relay URL. */
export class ShowmarkConfigError extends ShowmarkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIG", message, options);
    this.name = "ShowmarkConfigError";
  }
}

/** An argument failed validation before anything was signed or sent. */
export class ShowmarkInputError extends ShowmarkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("INVALID_INPUT", message, options);
    this.name = "ShowmarkInputError";
  }
}

/** The account or wallet refused or failed to sign. */
export class ShowmarkSigningError extends ShowmarkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("SIGNING", message, options);
    this.name = "ShowmarkSigningError";
  }
}

/** The request never got a usable answer: offline, DNS, timeout, RPC down, or a malformed response body. */
export class ShowmarkNetworkError extends ShowmarkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("NETWORK", message, options);
    this.name = "ShowmarkNetworkError";
  }
}

/**
 * The relayer answered with an error. `apiCode`, `message` and `action` come straight from the
 * Showmark API error body, so `message` says what happened and `action` says what to do next.
 */
export class ShowmarkRelayError extends ShowmarkError {
  readonly status: number;
  readonly apiCode: string;
  readonly action: string;

  constructor(params: { status: number; apiCode: string; message: string; action: string }, options?: { cause?: unknown }) {
    super("RELAY", params.message, options);
    this.name = "ShowmarkRelayError";
    this.status = params.status;
    this.apiCode = params.apiCode;
    this.action = params.action;
  }
}

/** A contract read reverted or the address holds no contract. `revertName` is set when the revert decodes. */
export class ShowmarkContractError extends ShowmarkError {
  readonly functionName: string;
  readonly revertName: string | null;

  constructor(params: { functionName: string; revertName: string | null; message: string }, options?: { cause?: unknown }) {
    super("CONTRACT", params.message, options);
    this.name = "ShowmarkContractError";
    this.functionName = params.functionName;
    this.revertName = params.revertName;
  }
}

export function isShowmarkError(value: unknown): value is ShowmarkError {
  return value instanceof ShowmarkError;
}
