import { afterEach, describe, expect, it } from "vitest";

import {
  environmentName,
  gitSha,
  knownProductionHosts,
  productionRouteDetected,
  serviceVersion,
  viewerUrlFor,
} from "../config";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("environmentName", () => {
  it("parses deployment.environment.name out of OTEL_RESOURCE_ATTRIBUTES", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging,foo=bar";
    expect(environmentName()).toBe("staging");
  });

  it("ignores whitespace around keys/values", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = " deployment.environment.name = production , foo=bar";
    expect(environmentName()).toBe("production");
  });

  it("falls back to 'unknown' when the attribute is absent", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "foo=bar";
    expect(environmentName()).toBe("unknown");
  });

  it("falls back to 'unknown' when OTEL_RESOURCE_ATTRIBUTES is unset", () => {
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    expect(environmentName()).toBe("unknown");
  });
});

describe("gitSha / serviceVersion", () => {
  it("read MIRA_GIT_SHA / MIRA_APP_VERSION, falling back to 'unknown'", () => {
    delete process.env.MIRA_GIT_SHA;
    delete process.env.MIRA_APP_VERSION;
    expect(gitSha()).toBe("unknown");
    expect(serviceVersion()).toBe("unknown");

    process.env.MIRA_GIT_SHA = "abc123";
    process.env.MIRA_APP_VERSION = "2.35.1";
    expect(gitSha()).toBe("abc123");
    expect(serviceVersion()).toBe("2.35.1");
  });
});

describe("viewerUrlFor", () => {
  it("returns null when MIRA_TRACE_VIEWER_URL_TEMPLATE is unset", () => {
    delete process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE;
    expect(viewerUrlFor("a".repeat(32))).toBeNull();
  });

  it("substitutes {traceId} into the template", () => {
    process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE =
      "https://us.cloud.langfuse.com/project/x/traces/{traceId}";
    expect(viewerUrlFor("deadbeef")).toBe(
      "https://us.cloud.langfuse.com/project/x/traces/deadbeef",
    );
  });
});

describe("productionRouteDetected", () => {
  it("returns [] outside staging even when a production host is configured", () => {
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    process.env.INGEST_URL = "https://app.factorylm.com/ingest";
    expect(environmentName()).toBe("unknown");
    expect(productionRouteDetected()).toEqual([]);
  });

  it("returns [] in staging when no route points at a production host", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
    process.env.INGEST_URL = "disabled://staging";
    process.env.NEXT_PUBLIC_PIPELINE_API_URL = "http://127.0.0.1:4099";
    process.env.MIRA_HUB_URL = "http://stg-mira-hub:3000";
    delete process.env.NEXTAUTH_URL_INTERNAL;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(productionRouteDetected()).toEqual([]);
  });

  it("names the offending var(s) — never their values — when staging routes to a known prod host", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
    process.env.NEXTAUTH_URL_INTERNAL = "https://app.factorylm.com/api/auth";
    process.env.MIRA_HUB_URL = "http://stg-mira-hub:3000";
    delete process.env.INGEST_URL;
    delete process.env.NEXT_PUBLIC_PIPELINE_API_URL;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const offending = productionRouteDetected();
    expect(offending).toEqual(["NEXTAUTH_URL_INTERNAL"]);
    expect(offending.join(",")).not.toContain("app.factorylm.com");
  });

  it("detects the bare production IP host too", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://40.160.141.61:4318/v1/traces";
    delete process.env.INGEST_URL;
    delete process.env.NEXT_PUBLIC_PIPELINE_API_URL;
    delete process.env.MIRA_HUB_URL;
    delete process.env.NEXTAUTH_URL_INTERNAL;

    expect(productionRouteDetected()).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  });
});

describe("knownProductionHosts", () => {
  it("is the fixed production host list", () => {
    expect(knownProductionHosts()).toEqual([
      "app.factorylm.com",
      "factorylm.com",
      "40.160.141.61",
    ]);
  });
});
