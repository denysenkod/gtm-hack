export class ProcurementApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "ProcurementApiError";
  }
}
