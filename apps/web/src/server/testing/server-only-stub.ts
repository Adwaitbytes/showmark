// Vitest resolves `server-only` here. The real package throws outside a React Server Components build,
// which would stop tests from importing server modules that are correctly marked server-only.
export {};
