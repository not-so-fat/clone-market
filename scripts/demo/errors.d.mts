export type DemoErrorCode =
  | "demo_invalid_args"
  | "demo_node_version"
  | "demo_dependencies_missing"
  | "demo_port_occupied"
  | "demo_port_unavailable"
  | "demo_build_failed"
  | "demo_fixture_failed"
  | "demo_seed_failed"
  | "demo_web_failed"
  | "demo_web_not_ready";

export declare const DEMO_ERROR_CODES: DemoErrorCode[];

export declare class DemoError extends Error {
  readonly code: DemoErrorCode;
  readonly remediation: string;
  constructor(code: DemoErrorCode, message: string, remediation: string);
  format(): string;
}
