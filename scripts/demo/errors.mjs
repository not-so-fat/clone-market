// Typed demo failures. Every code has a concise operator remediation.

/** Machine-readable demo failure codes. */
export const DEMO_ERROR_CODES = [
  "demo_invalid_args",
  "demo_node_version",
  "demo_dependencies_missing",
  "demo_port_occupied",
  "demo_port_unavailable",
  "demo_build_failed",
  "demo_fixture_failed",
  "demo_seed_failed",
  "demo_web_failed",
  "demo_web_not_ready",
];

export class DemoError extends Error {
  /**
   * @param {string} code one of DEMO_ERROR_CODES
   * @param {string} message one-line failure summary
   * @param {string} remediation one-line operator fix
   */
  constructor(code, message, remediation) {
    super(message);
    this.name = "DemoError";
    this.code = code;
    this.remediation = remediation;
  }

  /** Single-line CLI rendering: error[<code>]: <message> Fix: <remediation> */
  format() {
    return `error[${this.code}]: ${this.message} Fix: ${this.remediation}`;
  }
}
