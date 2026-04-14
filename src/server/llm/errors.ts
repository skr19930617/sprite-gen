export class InvalidLlmResponseError extends Error {
  override readonly name = 'InvalidLlmResponseError';
  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}

export class LlmTimeoutError extends Error {
  override readonly name = 'LlmTimeoutError';
}

export class LlmUpstreamError extends Error {
  override readonly name = 'LlmUpstreamError';
  readonly upstream: unknown;
  constructor(message: string, upstream?: unknown) {
    super(message);
    this.upstream = upstream;
  }
}
