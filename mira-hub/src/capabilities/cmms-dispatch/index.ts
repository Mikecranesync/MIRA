/**
 * Public surface of the notebook domain-event outbox → CMMS dispatcher
 * capability (#5020). Re-exports only — no logic lives here, so this file
 * never needs its own tests.
 */
export * from "./types";
export * from "./policy";
export * from "./enqueue";
export * from "./target";
export * from "./dispatcher";
export * from "./status";
