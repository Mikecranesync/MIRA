# FactoryLM Data Tier Architecture

**How the four subscription tiers are implemented technically**

---

## Overview

The pricing model is a data cooperative: customers who contribute anonymized data to improve MIRA for everyone pay less. Customers who want isolation pay a premium. The architecture must support four tiers without requiring a separate deployment per customer.

```
                    Knowledge Cooperative
                    (anonymized patterns)
                           ^
                           |
    Community Tier ------->| contributes + receives
    Professional Tier      | does NOT contribute, does NOT receive  
    Enterprise Tier        | isolated, optional opt-in
    On-Premise Tier        | zero data leaves their network
```

---

## Tier 1: Community ($499/facility/month)

**Database:** Shared NeonDB instance, shared schema. All Community customers share the same `kb_chunks`, `interactions`, `work_orders`, `cmms_equipment` tables with a `tenant_id` column for logical isolation.

**Data flow:**
```
Tech → MIRA (chat adapter) → GSDEngine → NeonDB (shared, tenant_id filtered)
                                  |
                                  v
                          Anonymization Pipeline
                                  |
                                  v
                          Knowledge Cooperative DB
                          (anonymized patterns only)
                                  |
                                  v
                          All Community customers benefit
```

**What gets anonymized and contributed:**
- Fault code frequency by equipment class (e.g., "5-15HP VFDs: OC fault rate = X per 1000 hrs")
- Resolution strategy effectiveness (e.g., "accel time adjustment resolves 73% of OC faults")
- MTTR benchmarks by fault type and equipment class
- Seasonal failure pattern correlations
- OEM reliability indicators (aggregated across 10+ facilities to prevent identification)

**What is NEVER shared:**
- Facility names, addresses, GPS
- Asset tags, serial numbers
- Employee names, chat handles
- Conversation text, photos
- Work order descriptions with proprietary info
- Raw sensor data streams
- OEM documentation (licensed content)

**Implementation:**
```sql
-- Shared tables with tenant_id
CREATE TABLE interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    chat_id TEXT NOT NULL,
    -- ... existing columns
);

-- Row-level security policy
CREATE POLICY tenant_isolation ON interactions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Knowledge Cooperative table (anonymized, no tenant_id)
CREATE TABLE knowledge_cooperative (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_class TEXT NOT NULL,       -- "VFD 5-15HP" not "GS10-45P0"
    fault_category TEXT NOT NULL,        -- "overcurrent" not specific code
    resolution_strategy TEXT,
    effectiveness_score FLOAT,
    sample_size INT,                     -- must be >= 10 facilities
    region TEXT,                         -- "Southeast US" not specific address
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Anonymization Pipeline (Celery task, runs nightly):**
1. Query interactions/work_orders grouped by equipment_class + fault_category
2. Filter: only include patterns with data from >= 10 distinct tenant_ids (k-anonymity)
3. Generalize: equipment model → equipment class, location → region
4. Suppress: any group with < 10 contributing facilities
5. Insert into knowledge_cooperative table
6. MIRA's RAG queries this table for Community Tier customers: "Based on data from 47 facilities, VFDs in this class typically..."

---

## Tier 2: Professional ($649/facility/month — 30% premium)

**Database:** Same NeonDB instance but **separate Neon branch or separate database** per customer. NeonDB's branching feature is perfect here — instant copy-on-write branches with near-zero storage overhead.

**Data flow:**
```
Tech → MIRA (chat adapter) → GSDEngine → NeonDB (customer's branch)
                                  |
                                  X  (NO anonymization pipeline)
                                  X  (NO Knowledge Cooperative contribution)
                                  X  (NO Knowledge Cooperative benefit)
```

**What's different from Community:**
- Customer's data is in a separate Neon branch (or separate DB in catalog pattern)
- No data flows to the anonymization pipeline
- MIRA does NOT query the Knowledge Cooperative for this customer
- Customer gets MIRA's base intelligence (OEM manuals, built-in knowledge) but not crowd-sourced patterns

**Implementation:**
```python
# Tenant configuration
class TenantConfig:
    tenant_id: str
    tier: Literal["community", "professional", "enterprise", "onprem"]
    database_url: str  # Community: shared DB, Professional: branch URL
    knowledge_cooperative: bool  # True for Community, False for Professional

# In GSDEngine, before querying Knowledge Cooperative:
if tenant_config.knowledge_cooperative:
    cooperative_context = query_knowledge_cooperative(equipment_class, fault_type)
else:
    cooperative_context = None  # Professional tier: no cooperative data
```

**NeonDB branch per Professional customer:**
```bash
# Create a new branch for a Professional customer
neon branches create --project-id $PROJECT_ID --name "tenant-acme-corp"
# Returns a connection string for the branch
# The branch shares the base data (OEM manuals) but customer data is isolated
```

---

## Tier 3: Enterprise ($899+$19/seat/month — custom)

**Database:** Dedicated NeonDB database instance OR customer's own PostgreSQL instance (BYOD).

**Data flow:**
```
Tech → MIRA (chat adapter) → GSDEngine → Customer's DB (dedicated or BYOD)
                                  |
                                  v  (optional opt-in)
                          Anonymization Pipeline
                                  v
                          Knowledge Cooperative (if opted in)
```

**What's different from Professional:**
- Fully dedicated database instance (not a branch)
- SSO/SAML integration
- Custom CMMS connectors (SAP PM, Maximo, etc.)
- Dedicated support channel (Slack/Teams)
- Custom SLA
- Option to opt INTO the Knowledge Cooperative (get the benefits while maintaining isolation)

**BYOD (Bring Your Own Database):**
```python
# Enterprise customer provides their own Postgres connection
# We create the schema in their DB
class BYODSetup:
    def provision(self, customer_db_url: str):
        # 1. Connect to customer's Postgres
        # 2. Run our migration scripts to create MIRA tables
        # 3. Verify connectivity
        # 4. Store connection string (encrypted) in our config DB
        # 5. All MIRA operations for this tenant use their DB
        pass
```

**Professional services for Enterprise:**
- Initial setup: $2,000-$5,000 (role config, asset library, QR deployment)
- CMMS integration: $5,000-$15,000 (depends on CMMS complexity)
- Custom reporting: $2,000-$5,000
- Ongoing: included in subscription

---

## Tier 4: On-Premise (Custom pricing — license + annual maintenance)

**Database:** Customer's own PostgreSQL, running on Customer's own servers.

**Data flow:**
```
Tech → MIRA (on-prem container) → GSDEngine (on-prem) → Customer's PostgreSQL (on-prem)
         |
         v
  AI Inference: Customer's choice
  Option A: Groq/Gemini/Claude (cloud, requires internet)
  Option B: Local Ollama/qwen2.5 (air-gapped, no internet needed)
```

**What's different from Enterprise:**
- Everything runs on Customer's hardware
- Docker Compose deployment package
- No data leaves Customer's network (when using local inference)
- Customer handles: hardware, OS, backups, networking, SSL
- Provider handles: software updates (Docker images), remote troubleshooting (if allowed)

**Deployment package:**
```yaml
# docker-compose.onprem.yml
services:
  mira-pipeline:
    image: ghcr.io/factorylm/mira-pipeline:${VERSION}
    environment:
      - NEON_DATABASE_URL=postgresql://mira@localhost:5432/mira
      - INFERENCE_BACKEND=local  # Uses Ollama
      - OLLAMA_HOST=http://ollama:11434
    
  mira-hub:
    image: ghcr.io/factorylm/mira-hub:${VERSION}
    ports:
      - "443:3000"
    
  mira-telegram:
    image: ghcr.io/factorylm/mira-telegram:${VERSION}
    
  postgres:
    image: pgvector/pgvector:pg16
    volumes:
      - pgdata:/var/lib/postgresql/data
    
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_models:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]  # If available
```

**Licensing model:**
- Annual license fee: $X per facility
- Includes: software, updates, remote support
- Does NOT include: hardware, hosting, network, local IT support
- License check: periodic online ping (quarterly) OR offline activation key for air-gapped facilities

---

## Architecture Decisions

### Decision 1: Tenant Routing

All MIRA requests go through a tenant router that determines which database to use:

```python
class TenantRouter:
    def __init__(self, config_db_url: str):
        self.config_db = connect(config_db_url)
    
    def get_connection(self, tenant_id: str) -> str:
        """Returns the database URL for a given tenant."""
        tenant = self.config_db.query(
            "SELECT tier, database_url FROM tenants WHERE id = %s", 
            tenant_id
        )
        if tenant.tier == "community":
            return SHARED_DB_URL  # With tenant_id in session
        elif tenant.tier == "professional":
            return tenant.database_url  # Neon branch URL
        elif tenant.tier == "enterprise":
            return tenant.database_url  # Dedicated or BYOD URL
        elif tenant.tier == "onprem":
            raise ValueError("On-prem tenants don't route through cloud")
```

### Decision 2: Knowledge Cooperative Pipeline

Runs as a Celery beat task, nightly at 2 AM:

```python
@celery.task
def build_knowledge_cooperative():
    """Aggregate anonymized patterns from all Community tier tenants."""
    
    # 1. Get all Community tier tenants
    community_tenants = get_tenants_by_tier("community")
    
    # 2. For each equipment class, aggregate fault patterns
    for eq_class in EQUIPMENT_CLASSES:
        patterns = []
        for tenant in community_tenants:
            db = get_connection(tenant.id)
            tenant_patterns = db.query("""
                SELECT fault_category, COUNT(*) as count,
                       AVG(resolution_time_min) as avg_mttr
                FROM work_orders
                WHERE equipment_class = %s
                  AND created_at > NOW() - INTERVAL '90 days'
                GROUP BY fault_category
            """, eq_class)
            patterns.extend(tenant_patterns)
        
        # 3. K-anonymity check: only include if >= 10 tenants contributed
        contributing_tenants = len(set(p.tenant_id for p in patterns))
        if contributing_tenants < 10:
            continue  # Suppress — not enough diversity
        
        # 4. Aggregate and write to cooperative table
        aggregated = aggregate_patterns(patterns)
        write_to_cooperative(eq_class, aggregated)
```

### Decision 3: What Happens at Tier Boundaries

| Event | What Happens |
|---|---|
| Community → Professional upgrade | New Neon branch created. Data migrated from shared to branch. Anonymization pipeline stops processing this tenant. Takes effect next billing cycle. |
| Professional → Community downgrade | Customer signs data sharing consent. Data merged back to shared. Pipeline starts including this tenant. 30-day notice required. |
| Professional → Enterprise upgrade | Dedicated instance or BYOD provisioned. Data migrated. Custom integrations set up. |
| Any → On-Premise | Docker images shipped. Customer provisions hardware. Data export provided. Cloud subscription ends. |

---

## Pricing Summary

| Tier | Monthly (per facility) | Data Sharing | Database | Knowledge Cooperative |
|---|---|---|---|---|
| Community | $499 | Anonymized patterns shared | Shared NeonDB | Contributes + receives |
| Professional | $649 (+30%) | Isolated, no sharing | NeonDB branch | Neither contributes nor receives |
| Enterprise | $899 + $19/seat | Isolated, opt-in available | Dedicated or BYOD | Optional participation |
| On-Premise | Custom quote | Zero data leaves network | Customer-hosted PostgreSQL | Not available |

**Professional services (all tiers):**
| Service | Price |
|---|---|
| Platform setup and configuration | $2,000 - $5,000 |
| CMMS integration (standard) | Included in Professional+ |
| CMMS integration (custom/legacy) | $5,000 - $15,000 |
| Additional language/locale setup | $500 per language |
| QR code deployment (per facility) | $500 |
| Annual maintenance review | $1,000 |

---

## Implementation Priority

1. **Now:** Add `tenant_id` column to all tables. Add `tier` to tenant config. (Schema change, no code impact.)
2. **Week 1-2:** Build tenant router. Route Community tier through shared DB with RLS.
3. **Week 3-4:** Build NeonDB branch provisioning for Professional tier.
4. **Week 5-6:** Build anonymization pipeline (Celery task, nightly).
5. **Month 2:** Build Knowledge Cooperative query integration in GSDEngine.
6. **Month 3:** Build BYOD provisioning for Enterprise tier.
7. **Month 4:** Package Docker Compose for On-Premise tier.

---

*This architecture supports the pricing model defined in the MSA. The key principle: Community tier is the default, and every higher tier adds isolation at a premium. The data cooperative gets more valuable as more Community customers participate, which creates a virtuous cycle.*
