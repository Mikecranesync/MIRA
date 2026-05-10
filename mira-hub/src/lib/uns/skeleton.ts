/**
 * UNS skeleton tree.
 *
 * The skeleton encodes the canonical structure of the Unified Namespace
 * — every literal type-marker label that exists in the spec, even when
 * no entities have been ingested under it yet. The browse API merges
 * this skeleton with live `kg_entities` rows so the Hub UI shows the
 * full ISA-95 hierarchy from day one (most branches are theoretical;
 * they fill in as documentation arrives — Mike's directive 2026-05-08).
 *
 * Two kinds of children at any level:
 *
 *   - **Literal children** (type markers like `site`, `area`, `line`,
 *     `manuals`, `fault_codes`) — always present, even when empty.
 *     Returned by `getSkeletonChildren()` regardless of DB state.
 *
 *   - **Dynamic children** (instance labels like `orlando_plant`,
 *     `powerflex_525`, `f004`) — supplied by the DB query in
 *     `/api/uns/browse`. The skeleton tells the resolver "expect
 *     dynamic children here," but the actual labels come from data.
 *
 * Path-walking algorithm:
 *
 *   For each segment of the input path, look for an exact-match key in
 *   the current node's `children`. If absent, look for the wildcard `*`
 *   key (which means "any dynamic instance label is valid here"). If
 *   neither exists, the path is unknown to the skeleton and the
 *   resolver returns no literal children (DB-only).
 *
 * Spec: docs/specs/uns-kg-unification-spec.md §3.1 (broadened
 * 2026-05-08).
 */

export type SkeletonNode = {
  /** Plain-English description shown in browse responses. */
  readonly description?: string;
  /** True if this node holds dynamic instance labels (manufacturer
   *  slugs, site names, equipment IDs, …). Affects display hints
   *  only; the actual labels come from the DB. */
  readonly dynamic?: boolean;
  /** Recursive children. Use the literal segment name as the key, or
   *  the wildcard `"*"` key for any dynamic instance label. */
  readonly children?: { readonly [segment: string]: SkeletonNode };
};

/**
 * The four sub-branches every site-side equipment instance carries.
 * Defined once and spliced into every `equipment.*` slot in the tree.
 */
const EQUIPMENT_INSTANCE: SkeletonNode = {
  description: "An equipment instance placed at a physical location.",
  dynamic: true,
  children: {
    component: {
      description: "Sub-parts (bearings, motors, contactors, …).",
      children: { "*": { dynamic: true } },
    },
    datapoint: {
      description:
        "Real-time sensor values and tags (Layer 4 — telemetry stream, future).",
      children: {
        "*": { dynamic: true },
        // Examples Mike called out — the skeleton lists them so the
        // Hub UI can suggest them when an operator wires a new tag.
        motor_current: { description: "Motor current (A)." },
        temperature: { description: "Equipment surface / winding temperature." },
        vibration: { description: "Vibration ISO 10816 magnitude." },
      },
    },
    maintenance: {
      description: "PM, faults, work orders, parts inventory for this asset.",
      children: {
        pm_schedule: {
          description: "Preventive maintenance schedule entries.",
          children: { "*": { dynamic: true } },
        },
        fault_history: {
          description: "Recorded fault occurrences for this instance.",
          children: { "*": { dynamic: true } },
        },
        work_orders: {
          description: "Work orders linked to this instance.",
          children: { "*": { dynamic: true } },
        },
        parts_inventory: {
          description: "Spares stocked for this instance.",
          children: { "*": { dynamic: true } },
        },
      },
    },
    documentation: {
      description: "Manuals, schematics, procedures associated with this asset.",
      children: {
        manuals: { children: { "*": { dynamic: true } } },
        schematics: { children: { "*": { dynamic: true } } },
        procedures: { children: { "*": { dynamic: true } } },
      },
    },
  },
};

/**
 * The literal sub-branches that appear under every kb-side model node.
 */
const KB_MODEL_NODE: SkeletonNode = {
  description: "A specific equipment model in the knowledge base.",
  dynamic: true,
  children: {
    manuals: {
      description: "User / installation / service manuals for this model.",
      children: { "*": { dynamic: true } },
    },
    fault_codes: {
      description: "Fault / alarm codes documented for this model.",
      children: { "*": { dynamic: true } },
    },
    pm_schedules: {
      description: "PM intervals recommended by the manufacturer.",
      children: { "*": { dynamic: true } },
    },
    parts_lists: {
      description: "Bill of materials / spare parts catalog.",
      children: { "*": { dynamic: true } },
    },
  },
};

export const SKELETON: SkeletonNode = {
  description: "Root of the unified namespace.",
  children: {
    enterprise: {
      description: "Top of the UNS tree.",
      children: {
        knowledge_base: {
          description:
            "Manufacturer-organized catalog of equipment. Site-independent — same model, multiple sites.",
          children: {
            community: {
              description:
                "Knowledge Cooperative shared data (cross-customer benchmarks and patterns).",
              children: {
                "*": {
                  description: "An equipment class (e.g. VFDs, centrifugal pumps).",
                  dynamic: true,
                  children: {
                    common_faults: {
                      description: "Faults that recur across the class.",
                      children: { "*": { dynamic: true } },
                    },
                    mtbf_benchmarks: {
                      description: "Mean-time-between-failure benchmarks.",
                      children: { "*": { dynamic: true } },
                    },
                    resolution_patterns: {
                      description: "Diagnostic playbooks that worked.",
                      children: { "*": { dynamic: true } },
                    },
                  },
                },
              },
            },
            "*": {
              description: "A manufacturer (e.g. allen_bradley, siemens, abb).",
              dynamic: true,
              children: {
                "*": {
                  description:
                    "A product family (e.g. powerflex) — or a model directly when family is unknown.",
                  dynamic: true,
                  children: {
                    "*": KB_MODEL_NODE,
                  },
                },
              },
            },
          },
        },
        operations: {
          description:
            "Cross-cutting operational records (work orders, technicians, inventory, compliance).",
          children: {
            work_orders: {
              description: "Work orders across all sites.",
              children: { "*": { dynamic: true } },
            },
            technicians: {
              description: "Technician roster.",
              children: { "*": { dynamic: true } },
            },
            inventory: {
              description: "Parts inventory across all sites.",
              children: { "*": { dynamic: true } },
            },
            compliance: {
              description: "Regulatory / audit records.",
              children: { "*": { dynamic: true } },
            },
          },
        },
        // Wildcard for {company} — every other key under `enterprise`
        // is a customer / company root with the ISA-95 site hierarchy.
        "*": {
          description: "A company (customer / business unit).",
          dynamic: true,
          children: {
            fleet: {
              description: "Mobile / field equipment not tied to a fixed site.",
              children: { "*": { dynamic: true } },
            },
            shared_services: {
              description: "Cross-site shared resources.",
              children: { "*": { dynamic: true } },
            },
            site: {
              description: "Physical sites (plants, facilities).",
              children: {
                "*": {
                  description: "A site (e.g. orlando_plant).",
                  dynamic: true,
                  children: {
                    utilities: {
                      description: "Site-level utility systems.",
                      children: { "*": { dynamic: true } },
                    },
                    safety_systems: {
                      description: "Safety-critical equipment (LOTO, EHS, fire).",
                      children: { "*": { dynamic: true } },
                    },
                    environmental: {
                      description: "Environmental monitoring (air, water, sound).",
                      children: { "*": { dynamic: true } },
                    },
                    area: {
                      description: "Production / process areas.",
                      children: {
                        "*": {
                          description: "A production area (e.g. pump_station).",
                          dynamic: true,
                          children: {
                            equipment: {
                              description:
                                "Equipment placed directly in this area (no line).",
                              children: { "*": EQUIPMENT_INSTANCE },
                            },
                            line: {
                              description: "Production lines in this area.",
                              children: {
                                "*": {
                                  description: "A production line (e.g. line_3).",
                                  dynamic: true,
                                  children: {
                                    equipment: {
                                      description:
                                        "Equipment placed directly on this line (no work cell).",
                                      children: { "*": EQUIPMENT_INSTANCE },
                                    },
                                    work_cell: {
                                      description:
                                        "Work cells on this line (ISA-95).",
                                      children: {
                                        "*": {
                                          description:
                                            "A work cell (e.g. sump_cell).",
                                          dynamic: true,
                                          children: {
                                            equipment: {
                                              description:
                                                "Equipment in this work cell.",
                                              children: { "*": EQUIPMENT_INSTANCE },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Walk the SKELETON down to the node at `path` and return its children
 * in a form suitable for merging with DB-sourced dynamic children.
 *
 * Returns:
 *   { node, literalChildren } — `node` is the SkeletonNode at `path`
 *   (or null if the path doesn't match the skeleton at all), and
 *   `literalChildren` is the list of literal type-marker child names
 *   (excluding the `"*"` wildcard) that should always appear in the
 *   browse response, each annotated with its description.
 */
export function getSkeletonChildren(path: string): {
  node: SkeletonNode | null;
  literalChildren: Array<{ label: string; description: string }>;
} {
  if (!path) {
    return { node: null, literalChildren: [] };
  }

  const segments = path.split(".");
  let cursor: SkeletonNode | undefined = SKELETON;

  for (const seg of segments) {
    if (!cursor || !cursor.children) {
      return { node: null, literalChildren: [] };
    }
    if (cursor.children[seg]) {
      cursor = cursor.children[seg];
    } else if (cursor.children["*"]) {
      cursor = cursor.children["*"];
    } else {
      // Path doesn't match the skeleton — return the empty node so the
      // browse endpoint still falls back to DB-only children.
      return { node: null, literalChildren: [] };
    }
  }

  if (!cursor || !cursor.children) {
    return { node: cursor ?? null, literalChildren: [] };
  }

  const literalChildren: Array<{ label: string; description: string }> = [];
  for (const key of Object.keys(cursor.children)) {
    if (key === "*") continue;
    const child = cursor.children[key];
    literalChildren.push({
      label: key,
      description: child.description ?? "",
    });
  }
  literalChildren.sort((a, b) => a.label.localeCompare(b.label));
  return { node: cursor, literalChildren };
}

/** Returns `true` if the skeleton expects dynamic instance labels at
 *  the given path (the Hub UI uses this to render an "Add new ..."
 *  affordance). */
export function expectsDynamicChildren(path: string): boolean {
  const { node } = getSkeletonChildren(path);
  if (!node || !node.children) return false;
  return Boolean(node.children["*"]);
}

/** Returns the description string for the node at `path`, or empty. */
export function getNodeDescription(path: string): string {
  const { node } = getSkeletonChildren(path);
  return node?.description ?? "";
}
