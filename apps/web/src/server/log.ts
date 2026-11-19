// Structured JSON logs, one object per line, so Vercel log drains and `jq` can filter by `event` and `level`.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVEL_RANK: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /(private.?key|secret|token|password|cookie|authorization)/i;

function threshold(): number {
  const raw = process.env.LOG_LEVEL;
  if (raw && raw in LEVEL_RANK) return LEVEL_RANK[raw as keyof typeof LEVEL_RANK];
  return LEVEL_RANK.info;
}

function normalize(value: unknown, depth = 0): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    const out: Fields = { name: value.name, message: value.message };
    if ("shortMessage" in value && typeof value.shortMessage === "string") out.shortMessage = value.shortMessage;
    if (value.cause !== undefined && depth < 3) out.cause = normalize(value.cause, depth + 1);
    return out;
  }
  if (Array.isArray(value)) return depth > 4 ? "[array]" : value.map((v) => normalize(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 4) return "[object]";
    const out: Fields = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : normalize(v, depth + 1);
    return out;
  }
  return value;
}

function emit(level: Level, event: string, fields?: Fields): void {
  if (LEVEL_RANK[level] < threshold()) return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(normalize(fields ?? {}) as Fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
