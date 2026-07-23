export type OfficialProvider = "deepseek" | "stepfun";

const OFFICIAL_ENDPOINTS: Record<
  OfficialProvider,
  { readonly hostname: string; readonly pathname: string; readonly canonical: string }
> = {
  deepseek: {
    hostname: "api.deepseek.com",
    pathname: "/",
    canonical: "https://api.deepseek.com",
  },
  stepfun: {
    hostname: "api.stepfun.com",
    pathname: "/v1",
    canonical: "https://api.stepfun.com/v1",
  },
};

/**
 * Returns a canonical provider URL only for the provider's official HTTPS API.
 */
export function normalizeOfficialProviderBaseUrl(
  provider: OfficialProvider,
  value: string,
): string | null {
  try {
    const url = new URL(value);
    const expected = OFFICIAL_ENDPOINTS[provider];
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (
      url.protocol !== "https:" ||
      url.hostname !== expected.hostname ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      pathname !== expected.pathname
    ) {
      return null;
    }

    return expected.canonical;
  } catch {
    return null;
  }
}

export function isOfficialProviderBaseUrl(provider: OfficialProvider, value: string): boolean {
  return normalizeOfficialProviderBaseUrl(provider, value) !== null;
}
