# NSF STTR Phase I — Application Outline

## Program: NSF STTR (Small Business Technology Transfer)
## Funding: Up to $305,000 (Phase I) / $1,555,000 (Fast-Track)
## Duration: 6-18 months (Phase I)

---

## 1. Cover Page

- **Project Title:** MIRA: AI-Powered Guided Socratic Dialogue for Industrial Equipment Fault Diagnosis
- **Small Business:** Crane Sync Corporation (Lake Wales, FL)
- **Research Institution:** [FAU / UF — TBD based on partnership]
- **PI (Small Business):** Mike Harper, Founder & CEO
- **Co-PI (University):** [Dr. Torres / Dr. Ruiz — TBD]
- **NSF Topic Area:** Advanced Manufacturing / Artificial Intelligence
- **Requested Amount:** $305,000

---

## 2. Project Summary (1 page)

### Problem Statement

- 40% of maintenance diagnostic time is spent searching for information rather than fixing equipment
- The skilled maintenance workforce is aging out — 2.4 million manufacturing positions projected unfilled by 2030
- Existing CMMS systems provide event data but not diagnosis
- AR guidance systems show "how to fix" but not "what's wrong"
- Tribal knowledge locked in senior technicians' heads is disappearing with retirements

### Innovation

- First AI system applying Guided Socratic Dialogue methodology to industrial equipment fault diagnosis
- Equipment-agnostic via computer vision — reads nameplates and fault codes without per-machine configuration
- Delivered through messaging platforms technicians already use (zero adoption friction, no new app to install)
- Hybrid cloud/on-premise architecture for industrial privacy and security requirements
- pgvector semantic search across 5,493+ equipment knowledge entries, scalable to 50,000+

### Broader Commercial Potential

- $12B industrial maintenance software market, growing at 8.5% CAGR
- Serves plants with 50-500 employees — underserved by enterprise CMMS vendors
- Integrator channel model (ABB, Rockwell, Siemens system integrator partners)
- Initial market: Central Florida manufacturing; path to national deployment

---

## 3. Technical Objectives (Phase I)

### Objective 1: Validate Diagnostic Accuracy

**Research question:** Does MIRA's Guided Socratic Dialogue approach achieve expert-level fault diagnosis accuracy?

- Benchmark MIRA against expert technician diagnosis on 100+ fault scenarios across multiple equipment categories
- Target: 85%+ agreement with expert diagnosis within 4 conversational turns
- Methodology: Blind comparison study designed and executed by university research team
- Deliverable: Peer-reviewed validation report with statistical analysis

### Objective 2: Optimize Human-AI Interaction for Skilled Trades

**Research question:** What question sequencing and dialogue patterns produce fastest, most accurate diagnosis across technician skill levels?

- Study technician response patterns across experience levels: apprentice (0-3 yr), journeyman (3-10 yr), master (10+ yr)
- Identify failure modes in the dialogue — where do technicians get stuck or provide ambiguous answers?
- Develop and validate interaction quality metrics: time-to-diagnosis, question efficiency, user satisfaction, error recovery
- Deliverable: Evidence-based recommendations for Socratic Dialogue question tree optimization

### Objective 3: Vision Pipeline Validation

**Research question:** Is MIRA's computer vision pipeline reliable enough for real industrial conditions?

- Validate OCR accuracy across industrial nameplate types from 50+ equipment manufacturers
- Benchmark fault code recognition accuracy on real (not staged) factory equipment
- Test under actual factory conditions: variable lighting, angle, distance, dirty/damaged nameplates
- Deliverable: Vision pipeline performance report with identified failure modes and mitigation strategies

### Objective 4: Knowledge Base Architecture and Scalability

**Research question:** Does the knowledge retrieval architecture maintain accuracy and relevance as the knowledge base scales?

- Validate pgvector retrieval relevance at 5,000 / 20,000 / 50,000 entry scales
- Develop and test automated knowledge ingestion pipeline from PDF equipment manuals
- Define quality metrics for knowledge base entries
- Deliverable: Scalability analysis and recommendations for Phase II knowledge base expansion

---

## 4. Research Plan — University Contribution (minimum 30%)

### Scope of Work — University Research Activities

The research institution will contribute a minimum of 30% of the total Phase I budget and lead the following activities:

**Activity 1: Study Design and IRB**
- Design blind comparison study protocol for diagnostic accuracy validation (Objective 1)
- Obtain IRB approval for human subjects research (technician interviews and interaction studies)
- Develop data collection instruments (observation protocols, surveys, interview guides)

**Activity 2: Diagnostic Accuracy Validation Study**
- Recruit expert maintenance technicians as ground-truth raters (minimum 5, 10+ years experience)
- Execute 100+ fault scenario comparisons: expert technician vs. MIRA output
- Statistical analysis: agreement rate, Cohen's kappa, error pattern analysis
- Identify systematic error categories for Phase II improvement roadmap

**Activity 3: Human-AI Interaction Research**
- Recruit technician participants across skill levels for interaction study
- Analyze conversation logs for question efficiency and dialogue failure patterns
- Develop validated interaction quality metrics
- Propose evidence-based improvements to Socratic Dialogue question trees

**Activity 4: Publication and Dissemination**
- Co-author peer-reviewed paper on AI-guided industrial diagnosis methodology
- Target venues: IEEE Transactions on Industrial Informatics, ASME Manufacturing Science and Engineering Conference, or equivalent
- Conference presentation of findings

**Activity 5: Phase II Research Roadmap**
- Synthesize Phase I findings into recommended Phase II research directions
- Identify gaps requiring additional academic investigation

### University Personnel

- **Faculty Co-PI:** [Dr. Torres / Dr. Ruiz] — study design, supervision, publication (20% effort)
- **Graduate Research Assistant 1:** Study execution, data collection, analysis (100% effort, 12 months)
- **Graduate Research Assistant 2:** Interaction research, literature review (50% effort, 12 months)

---

## 5. Team Qualifications

### Mike Harper — Principal Investigator (Small Business)

- 20+ years as industrial maintenance technologist in Central Florida manufacturing
- PLC programming expertise: Allen-Bradley ControlLogix/CompactLogix, Micro820
- VFD commissioning and troubleshooting: Danfoss, ABB, Rockwell
- Motor control, conveyor systems, packaging equipment, HVAC
- Built MIRA prototype end-to-end: architecture, ML pipeline, vision pipeline, deployment
- Active relationships with manufacturing plant maintenance managers in Central Florida

### [University Co-PI] — Co-Principal Investigator (Research Institution)

- [Research background and relevant publications — fill in after partner confirmed]
- [Previous NSF funding history]
- [Relevant datasets and research infrastructure]
- [Graduate student mentoring track record]

---

## 6. Commercialization Plan

### Phase I (Months 1-18, NSF funded)
- Validate diagnostic accuracy with university research partner
- Deploy pilot instances at 2-3 Central Florida manufacturing plants
- Complete NSF I-Corps customer discovery (30+ interviews)
- Identify 1-2 system integrator channel partners
- Revenue: pre-commercial (NSF funded)

### Phase II (Months 18-36, NSF STTR Phase II or Fast-Track)
- Scale knowledge base from 5,493 to 50,000+ entries
- Integrate live PLC data feeds (Config 4-6)
- Expand pilot to 10+ plants
- Develop integrator onboarding program
- Target: first paying customers, $200K ARR by end of Phase II

### Post-Phase II (Year 3-5)
- Launch Cloud Free tier as lead generation channel
- Config 1-2 hardware box deployment at 50+ plants
- Integrator channel generating 40%+ of new revenue
- Config 4-6 live PLC integration for mid-market plants
- Target: 100+ customers, $2M ARR by Year 5

### Revenue Model
- **Cloud Free:** Free, knowledge-limited — converts to paid through proven value
- **Config 1-2 (Cloud Box):** $500-1,500/month per site
- **Config 3 (+ Vision):** $1,500-2,500/month per site
- **Config 4-6 (+ Live PLC):** $2,500-5,000/month per site
- **Config 7 (Enterprise):** Custom pricing, multi-site licensing

---

## 7. Budget (Phase I — $305,000)

| Category | Amount | Notes |
|----------|--------|-------|
| PI Salary (Harper) | $80,000 | 12 months, 50% effort |
| University Subcontract | $100,000 | Minimum 30% requirement — 2 grad students + faculty PI |
| Equipment | $25,000 | Edge hardware (Mac Mini M4), test sensors, Meta Ray-Ban glasses for vision testing |
| Cloud Services | $15,000 | Anthropic Claude API, NeonDB (pgvector), infrastructure hosting |
| Travel | $10,000 | University research visits, I-Corps cohort participation, IEEE/ASME conference |
| Materials & Supplies | $10,000 | Industrial equipment specimens for controlled testing |
| Indirect / Overhead | $65,000 | University subcontract overhead + small business indirect costs |
| **Total** | **$305,000** | |

*Note: Budget will require adjustment based on university indirect cost rate. Exact faculty effort and grad student stipend rates confirmed with research partner during proposal development.*

---

## 8. Broader Impacts

- **Workforce shortage:** Directly addresses the 2.4 million unfilled manufacturing positions projected by 2030, with specific focus on the diagnostic knowledge gap created by senior technician retirements
- **Democratizes expertise:** An apprentice-level technician with MIRA can perform at journeyman level on first-encounter equipment faults — this is quantifiable and testable
- **Reduces downtime:** Preliminary estimates suggest 25-40% reduction in diagnostic time; Phase I validation will produce rigorous data
- **Rural manufacturing:** Central Florida manufacturing communities (Polk County, Highlands County) are underserved by enterprise technology vendors — MIRA is sized for them
- **STEM pipeline:** Graduate research assistants gain experience at the intersection of AI, industrial systems, and human factors — an emerging and underserved research area
- **Open methodology:** Guided Socratic Dialogue methodology published openly for other researchers to build on

---

## 9. NSF I-Corps Alignment

- **Planned enrollment:** UCF I-Corps Site (Orlando) or USF I-Corps Site (Tampa)
- **Team:** Mike Harper (Entrepreneurial Lead) + University Co-PI (Technical Lead) + assigned I-Corps mentor
- **Customer discovery target:** 30+ interviews across maintenance managers, technicians, plant operators, OEM service departments, and system integrators
- **Timeline:** Complete I-Corps before Phase I decision to support Fast-Track application
- **Hypothesis to test:** "Maintenance managers at 50-500 employee manufacturing plants will pay $500-2,000/month for AI diagnostic co-pilot capability because it reduces their most expensive labor cost — diagnostic time — and fills the knowledge gap from retiring senior technicians."

---

## 10. Next Steps for Application

- [ ] Confirm university research partner (Dr. Torres / Dr. Ruiz)
- [ ] Co-PI completes NSF researcher profile if not current
- [ ] Register Crane Sync Corporation in SAM.gov (required for all federal grants)
- [ ] Apply to NSF I-Corps Site program (UCF or USF)
- [ ] Identify NSF program officer — schedule 15-min pre-submission call
- [ ] Draft Project Description (15 pages) — due 6-8 weeks before submission deadline
- [ ] Review current NSF STTR solicitation for any topic-area requirements
- [ ] Confirm budget with university grants office (indirect cost rates)
