/**
 * GitHub Issues adapter (G-002).
 *
 * The first concrete `IssueProvider`: creates one GitHub issue per
 * call through the REST issues endpoint using an injected token.
 * All GitHub specifics (endpoint, headers, payload, response mapping)
 * live in this module; the generic contract stays provider-neutral.
 * One call creates exactly one issue and nothing more: no edits,
 * no state changes, no synchronization, no second attempts.
 */

import { IssueProvider, IssueReference, IssueRequest, validateIssueReference, validateIssueRequest } from "./issue";

/** Stable adapter identity, local to this concrete module. */
export const GITHUB_PROVIDER_NAME = "github" as const;

const GITHUB_API_VERSION = "2022-11-28";

export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Transport seam. Production uses global fetch; tests inject a fake.
 * Local to this adapter, not a framework-wide abstraction.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

async function defaultTransport(request: HttpRequest): Promise<HttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export interface GitHubProviderOptions {
  /** Repository owner. Non-empty, no slashes; never auto-discovered. */
  readonly owner: string;
  /** Repository name. Non-empty, no slashes; never auto-discovered. */
  readonly repo: string;
  /** Credential, injected by the caller. Never logged or exposed. */
  readonly token: string;
  /** Overridable transport for tests. */
  readonly transport?: HttpTransport;
}

function fail(what: string): never {
  throw new Error(`github provider: invalid options (${what})`);
}

function nonEmptySegment(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    fail(`${field} must be a non-empty path segment`);
  }
  return value;
}

function requestBody(request: IssueRequest): string {
  if (request.requirements === undefined) {
    return request.description;
  }
  return `${request.description}\n\n## Requirements\n\n${request.requirements}`;
}

/**
 * Build a GitHub Issues provider. Validates owner, repo, and token up
 * front; rejects ambiguous targets instead of guessing them.
 */
export function createGitHubIssueProvider(options: GitHubProviderOptions): IssueProvider {
  if (typeof options !== "object" || options === null) {
    fail("expected an options object");
  }
  const owner = nonEmptySegment(options.owner, "owner");
  const repo = nonEmptySegment(options.repo, "repo");
  if (typeof options.token !== "string" || options.token.length === 0) {
    fail("token must be a non-empty string");
  }
  const token = options.token;
  const transport = options.transport ?? defaultTransport;
  return {
    name: GITHUB_PROVIDER_NAME,
    create: async (request: IssueRequest): Promise<IssueReference> => {
      const invocation = validateIssueRequest(request);
      let response: HttpResponse;
      try {
        response = await transport({
          url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: invocation.title, body: requestBody(invocation) }),
        });
      } catch {
        throw new Error("github provider: request failed");
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`github provider: request failed with status ${response.status}`);
      }
      const number =
        typeof response.body === "object" && response.body !== null
          ? (response.body as Record<string, unknown>).number
          : undefined;
      if (typeof number !== "number" || !Number.isFinite(number)) {
        throw new Error("github provider: unexpected response");
      }
      return validateIssueReference({ id: String(number) });
    },
  };
}
