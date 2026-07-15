/**
 * Fake HTTP client for testing HTTP-dependent components.
 *
 * Records requests and returns pre-configured responses.
 */

import { HttpJsonClient } from "../../src/infrastructure/http-json-client.js";
import type { HttpJsonResponse } from "../../src/infrastructure/http-json-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FakeResponse<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly headers: Headers;
  readonly requestId?: string;
}

export interface RecordedRequest {
  readonly path: string;
  readonly body: unknown;
}

// ---------------------------------------------------------------------------
// FakeHttpClient
// ---------------------------------------------------------------------------

export class FakeHttpClient extends HttpJsonClient {
  readonly recordedRequests: RecordedRequest[] = [];

  private _response: FakeResponse = {
    ok: true,
    status: 200,
    data: {},
    headers: new Headers(),
  };

  constructor() {
    super({
      baseUrl: "http://fake.local",
      apiKey: "fake-key",
      timeoutMs: 30_000,
    });
  }

  setResponse<T>(response: FakeResponse<T>): void {
    this._response = {
      ...response,
      headers: response.headers ?? new Headers(),
    };
  }

  override post<T = unknown>(_path: string, body: unknown): Promise<HttpJsonResponse<T>> {
    this.recordedRequests.push({ path: _path, body });

    const headers = new Headers(this._response.headers);
    if (this._response.requestId !== undefined) {
      headers.set("x-request-id", this._response.requestId);
    }

    return Promise.resolve({
      ok: this._response.ok,
      status: this._response.status,
      data: this._response.data as T,
      headers,
      ...(this._response.requestId !== undefined ? { requestId: this._response.requestId } : {}),
    });
  }
}
