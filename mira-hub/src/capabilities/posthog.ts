/**
 * Hub PostHog helpers — edge-safe (no DB).
 *
 * Ingest key is Doppler `PLG_POSTHOG_KEY` only (the public project key).
 * Never read a personal/admin PostHog key. Unset key = analytics off.
 * Session replay stays off. Autocapture stays off so the signup password
 * field cannot be captured. DNT/GPC is honored on the client snippet.
 */

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export function posthogKey(): string {
  // Ingest/project key only. Personal/admin keys (POSTHOG_PERSONAL_API_KEY,
  // POSTHOG_API_KEY, …) are never read.
  return (process.env.PLG_POSTHOG_KEY ?? "").trim();
}

export function posthogHost(): string {
  // `||`, not `??`: compose forwards an UNSET var as "" (${PLG_POSTHOG_HOST:-}).
  return (process.env.PLG_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, "");
}

export function posthogAssetHost(ingestHost: string = posthogHost()): string {
  return ingestHost.replace(".i.posthog.com", "-assets.i.posthog.com");
}

/** Origins for Hub CSP `script-src` + `connect-src`. No wildcards. */
export function posthogCspOrigins(): string[] {
  const ingest = posthogHost();
  const assets = posthogAssetHost(ingest);
  return ingest === assets ? [ingest] : [ingest, assets];
}

export function posthogCspOriginList(): string {
  return posthogCspOrigins().join(" ");
}

/** True when the public ingest key is configured. Admin-key env vars never count. */
export function posthogClientEnabled(): boolean {
  return Boolean(posthogKey());
}

/**
 * Stock PostHog loader (same shape as mira-web `/posthog-init.js`).
 * Method names include startSessionRecording because that's the client API
 * surface; we never CALL it, and init sets disable_session_recording.
 */
const POSTHOG_LOADER =
  "!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement(\"script\")).type=\"text/javascript\",p.crossOrigin=\"anonymous\",p.async=!0,p.src=s.api_host.replace(\".i.posthog.com\",\"-assets.i.posthog.com\")+\"/static/array.js\",(r=t.getElementsByTagName(\"script\")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=\"posthog\",u.people=u.people||[],u.toString=function(t){var e=\"posthog\";return\"posthog\"!==a&&(e+=\".\"+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+\".people (stub)\"},o=\"init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing\".split(\" \"),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);";

const NOOP_STUB =
  "// PostHog: PLG_POSTHOG_KEY is unset; analytics disabled.\n" +
  "window.posthog={capture:function(){},identify:function(){},init:function(){},reset:function(){},register_once:function(){}};\n";

export function buildPosthogInitJavaScript(opts?: { key?: string; host?: string }): string {
  const key = (opts?.key ?? posthogKey()).trim();
  const host = (opts?.host ?? posthogHost()).replace(/\/+$/, "");
  if (!key) return NOOP_STUB;

  const init = {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: true,
    persistence: "localStorage+cookie",
    disable_session_recording: true,
    autocapture: false,
    respect_dnt: true,
  };

  return (
    POSTHOG_LOADER +
    "\n" +
    `posthog.init(${JSON.stringify(key)}, ${JSON.stringify(init)});\n` +
    "try{var _p=new URLSearchParams(location.search);var _once={};['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){var v=_p.get(k);if(v)_once[k]=v;});if(Object.keys(_once).length)posthog.register_once(_once);}catch(e){}\n"
  );
}

export type SignupMethod = "credentials" | "google";

export function signupCompletedProperties(
  attribution: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    hasGclid: boolean;
    hasFbclid: boolean;
  },
  method: SignupMethod,
): Record<string, string | number | boolean | null> {
  return {
    method,
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_content: attribution.utmContent,
    utm_term: attribution.utmTerm,
    has_gclid: attribution.hasGclid,
    has_fbclid: attribution.hasFbclid,
  };
}
