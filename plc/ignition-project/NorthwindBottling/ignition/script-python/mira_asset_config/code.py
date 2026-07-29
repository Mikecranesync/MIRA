# asset_config.py -- per-asset tag->role config: parse/validate + build the diagnose read plan.
#
# Slice 1 of the auto-map phase (docs/specs/vfd-analyzer-auto-map-spec.md). The analyzer
# stores ONE config per asset as an Ignition Document/JSON tag (Option A). This module is the
# pure logic that turns that config into (a) a validated dict, (b) a read plan -- the exact tag
# paths to read + how to scale each -- and (c) the diagnose-core `snap`. No system.* imports;
# the gateway wiring (mira_diagnose/code.py) does the actual system.tag.readBlocking.
#
# Standalone by design (mirrors rules_core.py / tag_topic_map.py): it does NOT import
# signal_roles -- the caller passes the valid/required key sets in. `coerce` is inlined here
# (identical semantics to tag_topic_map.coerce); the seed==legacy parity test guarantees they
# agree, so the two copies cannot silently diverge.
#
# Dual Python 2.7 + 3.12-clean: no from __future__, no annotations, no f-strings, % formatting,
# ASCII only. JSON via the stdlib json module (present in both Jython 2.7 and CPython 3.12).

import json

# Dual Py2.7/3.12 string check: under Jython 2.7 (the live gateway) json.loads and
# Perspective table values arrive as `unicode`, which is NOT an instance of `str` -- so a
# plain isinstance(x, str) wrongly rejects every config read back from the tag (the
# manual map pick and the accept-all read-back both failed live for this reason). Accept
# both. Under CPython 3.12 (where the tests run) `unicode` doesn't exist, so this collapses
# to (str,) and behavior is unchanged.
try:
    string_types = (str, unicode)  # noqa: F821 -- Jython 2.7 / Python 2 only
except NameError:
    string_types = (str,)          # CPython 3.12

SCHEMA_VERSION = 1


class ConfigError(ValueError):
    """Raised when a config tag's JSON is missing, malformed, or fails validation."""
    pass


def load_config(text_or_dict, valid_keys=None):
    """Parse + validate an asset config.

    `text_or_dict` -- a JSON string (the Document tag's raw value) OR an already-decoded dict.
    `valid_keys`   -- optional set of legal role keys (from signal_roles.valid_keys()); when
                      given, every mapped role key must be a member or ConfigError is raised.

    Returns the validated config dict. Raises ConfigError on any structural problem.
    """
    if isinstance(text_or_dict, dict):
        cfg = text_or_dict
    else:
        try:
            cfg = json.loads(text_or_dict)
        except (ValueError, TypeError) as e:
            raise ConfigError("config is not valid JSON: %s" % (e,))
    if not isinstance(cfg, dict):
        raise ConfigError("config must be a JSON object, got %s" % type(cfg).__name__)

    if cfg.get("schemaVersion") != SCHEMA_VERSION:
        raise ConfigError("unsupported schemaVersion %r (expected %d)"
                          % (cfg.get("schemaVersion"), SCHEMA_VERSION))

    asset_id = cfg.get("assetId")
    if not isinstance(asset_id, string_types) or not asset_id.strip():
        raise ConfigError("assetId is required and must be a non-empty string")

    roles = cfg.get("roles")
    if not isinstance(roles, dict):
        raise ConfigError("roles is required and must be an object")

    for key in roles:
        if valid_keys is not None and key not in valid_keys:
            raise ConfigError("unknown signal role key: %s" % (key,))
        entry = roles[key]
        if not isinstance(entry, dict):
            raise ConfigError("role %s must be an object" % (key,))
        tag = entry.get("tag")
        if not isinstance(tag, string_types) or not tag.strip():
            raise ConfigError("role %s is missing a non-empty 'tag'" % (key,))
        if "divisor" not in entry:
            raise ConfigError("role %s is missing 'divisor'" % (key,))
        divisor = entry["divisor"]
        if not _is_valid_divisor(divisor):
            raise ConfigError("role %s has a non-numeric divisor: %r" % (key, divisor))

    return cfg


def _is_valid_divisor(divisor):
    if divisor is None:
        return True
    if isinstance(divisor, bool):   # bool is an int subclass in Python -- reject as a divisor
        return False
    return isinstance(divisor, (int, float))


def read_plan(config):
    """Turn a validated config into a parallel (paths, plan) the gateway reads.

    Returns:
      paths -- list of tag paths to read, deterministic order (sorted by role key).
      plan  -- list of (topic, divisor), parallel to `paths`.
    Only mapped roles are included; the plan IS the read allowlist.
    """
    roles = config["roles"]
    paths = []
    plan = []
    for topic in sorted(roles.keys()):
        entry = roles[topic]
        paths.append(entry["tag"])
        plan.append((topic, entry.get("divisor")))
    return paths, plan


def coerce(value, divisor):
    """Scale a raw tag value per its divisor. Identical semantics to tag_topic_map.coerce:
    None value or None divisor -> passthrough (bool/raw); divisor 1.0 -> int passthrough
    (codes/cmd word, keep type); else float(value)/divisor; non-numeric -> None."""
    if value is None or divisor is None:
        return value
    if divisor == 1.0:
        return value
    try:
        return float(value) / divisor
    except (TypeError, ValueError):
        return None


def build_snap_from_plan(plan, values):
    """Build the diagnose-core `snap` dict from a read plan + the values read for it.

    `plan`   -- list of (topic, divisor) from read_plan().
    `values` -- list parallel to `plan` (and to the paths read), the raw tag values. The caller
                is responsible for filtering bad-quality reads (pass None for those to drop them
                to a passthrough None, matching the legacy reader).
    Returns {topic: coerced_value}.
    """
    snap = {}
    n = min(len(plan), len(values))
    for i in range(n):
        topic, divisor = plan[i]
        snap[topic] = coerce(values[i], divisor)
    return snap


def required_unmapped(config, required_keys):
    """The required role keys that the config does not map -- the readiness gate's gap list.
    Order follows `required_keys` so the UI reports them predictably."""
    roles = config.get("roles", {})
    out = []
    for key in required_keys:
        if key not in roles:
            out.append(key)
    return out
