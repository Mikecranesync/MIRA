# FactoryLM Master Services Agreement

**DRAFT v1.0 — For Legal Review Before Use**

*This is a first draft. Have an attorney licensed in your jurisdiction review and finalize before presenting to customers.*

---

**MASTER SERVICES AGREEMENT**

This Master Services Agreement ("Agreement") is entered into as of the date of electronic acceptance ("Effective Date") by and between:

**FactoryLM, Inc.** ("Provider"), with its principal place of business at [ADDRESS], and

The entity identified in the applicable Order Form ("Customer").

By executing an Order Form that references this Agreement, or by accessing or using the Services, Customer agrees to be bound by this Agreement.

---

## 1. Definitions

**1.1 "Services"** means the MIRA Copilot AI-powered maintenance intelligence platform, the MIRA Hub dashboard, and any related APIs, chat adapters, and integrations provided by Provider under an Order Form.

**1.2 "Customer Data"** means all data, content, and information submitted to or generated through the Services by or on behalf of Customer, including but not limited to: equipment records, work orders, diagnostic conversations, photographs, sensor data, maintenance documentation, and user-generated content.

**1.3 "Anonymized Aggregate Data"** means data derived from Customer Data that has been irreversibly de-identified such that it cannot reasonably be used to identify Customer, any Customer facility, any individual, or any specific piece of equipment. Anonymized Aggregate Data includes only operational patterns, fault frequency distributions, resolution timing benchmarks, and equipment class performance metrics. It specifically excludes: facility names, addresses, GPS coordinates, asset tag numbers, serial numbers, employee names or identifiers, IP addresses, and any data that could be combined with other available information to re-identify Customer or individuals.

**1.4 "Subscription Tier"** means the service level selected by Customer as specified in the Order Form: Community, Professional, Enterprise, or On-Premise.

**1.5 "Order Form"** means a mutually executed document that references this Agreement and specifies the Subscription Tier, pricing, term, and any additional terms applicable to Customer's use of the Services.

**1.6 "Authorized Users"** means Customer's employees, contractors, and agents who are authorized by Customer to access and use the Services.

**1.7 "MIRA"** means the AI diagnostic engine that powers the Services, including the conversational interface, knowledge base, inference pipeline, and work order generation capabilities.

**1.8 "Knowledge Cooperative"** means the anonymized, aggregate intelligence layer that improves MIRA's diagnostic accuracy across all participating customers, as described in Section 7.

---

## 2. Services and Subscription Tiers

**2.1 Service Description.** Provider will make the Services available to Customer in accordance with the Subscription Tier selected in the Order Form.

**2.2 Subscription Tiers.** The following tiers are available:

**(a) Community Tier.** Customer's Anonymized Aggregate Data contributes to the Knowledge Cooperative. In exchange, Customer receives the base subscription rate and benefits from the collective intelligence of all participating customers. MIRA's diagnostic accuracy, failure pattern detection, and recommended resolution quality improve continuously as the Knowledge Cooperative grows.

**(b) Professional Tier.** Customer's data is logically isolated. Customer's data does NOT contribute to the Knowledge Cooperative, and Customer does NOT receive Knowledge Cooperative intelligence benefits. Customer's data resides in an isolated database schema. Professional Tier pricing reflects a premium over Community Tier to offset the value of non-participation in the Knowledge Cooperative, as specified in the Order Form.

**(c) Enterprise Tier.** Customer receives all Professional Tier isolation, plus: dedicated database instance, custom CMMS integrations, SSO/SAML authentication, dedicated support channel, and custom SLA. Customer may optionally elect to participate in the Knowledge Cooperative at Enterprise Tier pricing. Enterprise Tier pricing is specified in the Order Form.

**(d) On-Premise Tier.** Customer deploys the Services on Customer's own infrastructure. No Customer Data leaves Customer's network. Customer is responsible for hardware, hosting, backup, and network infrastructure. Provider provides the software, updates, and remote support. On-Premise Tier pricing includes a license fee and annual maintenance/support fee as specified in the Order Form.

**2.3 Tier Changes.** Customer may upgrade to a higher tier at any time. Upgrades take effect on the next billing cycle. Downgrades from Professional or Enterprise to Community require a 30-day notice period and Customer's affirmative consent to begin contributing Anonymized Aggregate Data to the Knowledge Cooperative.

---

## 3. Customer Obligations

**3.1 Authorized Use.** Customer will ensure that all Authorized Users comply with this Agreement and any applicable usage policies.

**3.2 Account Security.** Customer is responsible for maintaining the confidentiality of account credentials and for all activities that occur under Customer's account.

**3.3 Acceptable Use.** Customer will not: (a) use the Services to process data unrelated to industrial maintenance and operations; (b) attempt to reverse-engineer, decompile, or extract source code from the Services; (c) share access credentials with unauthorized parties; (d) use the Services in violation of applicable laws or regulations.

**3.4 Data Accuracy.** Customer acknowledges that MIRA's diagnostic output quality depends on the accuracy and completeness of Customer-provided equipment data, documentation, and contextual information. Provider is not liable for diagnostic inaccuracies resulting from incomplete or incorrect Customer Data.

---

## 4. Fees and Payment

**4.1 Fees.** Customer will pay the fees specified in the Order Form. Fees are based on the Subscription Tier and may include: per-facility monthly subscription, per-user seat fees, one-time setup/configuration fees, and professional services fees.

**4.2 Billing.** Fees are billed monthly or annually as specified in the Order Form. All fees are due within thirty (30) days of invoice date.

**4.3 Price Changes.** Provider may adjust pricing with sixty (60) days' written notice prior to the start of a renewal term. Customer may terminate rather than accept a price increase.

**4.4 Taxes.** Fees are exclusive of all taxes, levies, and duties. Customer is responsible for all applicable taxes, excluding taxes based on Provider's net income.

**4.5 Late Payment.** Past-due amounts accrue interest at the lesser of 1.5% per month or the maximum rate permitted by law.

**4.6 Setup and Configuration Services.** Provider offers optional professional services for initial platform configuration, including: role and permission setup, asset library population, QR code deployment, CMMS integration configuration, and automated briefing schedule setup. These services are billed at the rates specified in the Order Form and are separate from the subscription fee.

---

## 5. Data Ownership and Rights

**5.1 Customer Data Ownership.** As between the parties, Customer retains all right, title, and interest in and to Customer Data. Provider acquires no ownership rights in Customer Data.

**5.2 License to Provider.** Customer grants Provider a non-exclusive, worldwide license to use, process, store, and transmit Customer Data solely for the purpose of providing the Services. For Community Tier customers, this license additionally includes the right to create Anonymized Aggregate Data as described in Section 7.

**5.3 Provider IP.** Provider retains all right, title, and interest in and to the Services, including all software, algorithms, models, documentation, and intellectual property. Customer's use of the Services does not transfer any Provider IP to Customer.

**5.4 Feedback.** Any suggestions, enhancement requests, or feedback provided by Customer regarding the Services may be used by Provider without obligation or compensation.

---

## 6. Data Processing and Security

**6.1 Security Measures.** Provider will implement and maintain commercially reasonable administrative, technical, and physical security measures to protect Customer Data, including: encryption in transit (TLS 1.2+) and at rest (AES-256), access controls, regular security assessments, and incident response procedures.

**6.2 Data Location.** For Community and Professional Tiers, Customer Data is stored in Provider's cloud infrastructure hosted in the United States (NeonDB on AWS). For Enterprise Tier, Customer may specify data residency requirements. For On-Premise Tier, all data resides on Customer's infrastructure.

**6.3 Subprocessors.** Provider may use third-party subprocessors to provide the Services (e.g., cloud hosting, inference providers, analytics). Provider will maintain a current list of subprocessors available upon request and will notify Customer of material changes to subprocessors with thirty (30) days' notice.

**6.4 Data Processing Agreement.** If Customer's use of the Services involves the processing of personal data subject to GDPR, CCPA, or similar data protection laws, the parties will execute a Data Processing Agreement ("DPA") which will be incorporated by reference into this Agreement.

**6.5 AI Inference Providers.** The Services may route diagnostic queries through third-party AI inference providers (e.g., Groq, Google, Anthropic, Cerebras). Customer Data included in diagnostic queries is processed by these providers subject to their respective data processing terms. Provider will not route Customer Data to inference providers that do not maintain commercially reasonable data protection commitments.

---

## 7. Knowledge Cooperative and Anonymized Data

**7.1 Purpose.** The Knowledge Cooperative is an anonymized intelligence layer that improves MIRA's diagnostic accuracy for all participating customers. It operates on the principle that equipment failure patterns, resolution strategies, and maintenance timing insights become more valuable when aggregated across many facilities and equipment types.

**7.2 Participation.** Participation in the Knowledge Cooperative is determined by Customer's Subscription Tier:

**(a) Community Tier:** Customer participates by default. Customer's Anonymized Aggregate Data contributes to the Knowledge Cooperative, and Customer receives the benefits of collective intelligence. This participation is a material part of the value exchange that enables Community Tier pricing.

**(b) Professional, Enterprise, and On-Premise Tiers:** Customer does NOT participate unless Customer explicitly opts in. Customer's data remains isolated and is not used for the Knowledge Cooperative.

**7.3 What Is Shared.** Only Anonymized Aggregate Data is contributed to the Knowledge Cooperative. Specifically:

**(a) Included:** Fault code frequency by equipment class (e.g., "VFDs in the 5-15HP range experience overcurrent faults at a rate of X per 1,000 operating hours"), resolution strategy effectiveness metrics, mean time to repair benchmarks by equipment category, seasonal failure pattern correlations, and OEM-specific reliability indicators.

**(b) Excluded:** Any data that could identify Customer, a Customer facility, an individual, or a specific piece of equipment. This includes but is not limited to: company names, facility names or addresses, GPS coordinates, asset tag numbers, serial numbers, employee names or identifiers, photographs, chat conversation text, work order descriptions containing proprietary information, and sensor data streams.

**7.4 Anonymization Standards.** Provider will apply industry-standard anonymization techniques including: (a) removal of all direct identifiers; (b) generalization of quasi-identifiers (e.g., geographic region instead of facility address, equipment class instead of specific model); (c) suppression of data points where the combination of attributes could enable re-identification; (d) statistical noise injection where appropriate. Provider will periodically review and update anonymization techniques to reflect current best practices.

**7.5 No Re-Identification.** Provider will not attempt to re-identify any Customer or individual from Anonymized Aggregate Data. Provider will contractually prohibit any third party with access to Anonymized Aggregate Data from attempting re-identification.

**7.6 Withdrawal.** A Community Tier Customer who upgrades to Professional or higher tier will cease contributing new data to the Knowledge Cooperative effective upon the tier change. Anonymized Aggregate Data already contributed prior to the tier change cannot be retroactively removed, as it has been irreversibly anonymized and aggregated.

**7.7 Transparency.** Provider will make available to Customer upon request: (a) a description of the categories of Anonymized Aggregate Data derived from Customer Data; (b) a summary of how the Knowledge Cooperative intelligence is used to improve the Services; and (c) aggregate statistics about Knowledge Cooperative participation (e.g., number of participating facilities, equipment classes covered).

---

## 8. Confidentiality

**8.1 Definition.** "Confidential Information" means any non-public information disclosed by one party to the other in connection with this Agreement, including but not limited to: business plans, technical data, product designs, customer lists, pricing, and financial information. Confidential Information does not include information that: (a) is or becomes publicly available without breach of this Agreement; (b) was known to the receiving party prior to disclosure; (c) is independently developed by the receiving party; or (d) is received from a third party without restriction.

**8.2 Obligations.** Each party will: (a) protect the other's Confidential Information using at least the same degree of care it uses for its own; (b) not disclose Confidential Information to third parties except as necessary to perform under this Agreement; and (c) limit access to Confidential Information to personnel who need to know and are bound by confidentiality obligations.

**8.3 Compelled Disclosure.** A party may disclose Confidential Information to the extent required by law or regulation, provided the disclosing party gives prompt written notice (where legally permitted) to allow the other party to seek protective measures.

---

## 9. Warranties and Disclaimers

**9.1 Provider Warranties.** Provider warrants that: (a) the Services will perform materially in accordance with the applicable documentation; (b) Provider will provide the Services in a professional and workmanlike manner; and (c) Provider has the authority to enter into this Agreement.

**9.2 AI Diagnostic Disclaimer.** CUSTOMER ACKNOWLEDGES THAT MIRA IS AN AI-POWERED DIAGNOSTIC ASSISTANCE TOOL AND NOT A SUBSTITUTE FOR QUALIFIED MAINTENANCE PERSONNEL. MIRA'S DIAGNOSTIC OUTPUTS ARE RECOMMENDATIONS BASED ON AVAILABLE DATA AND SHOULD BE VERIFIED BY QUALIFIED TECHNICIANS BEFORE ACTION IS TAKEN. PROVIDER DOES NOT WARRANT THAT MIRA'S DIAGNOSTIC OUTPUTS WILL BE ACCURATE, COMPLETE, OR SUITABLE FOR ANY PARTICULAR PURPOSE. CUSTOMER IS SOLELY RESPONSIBLE FOR ALL MAINTENANCE DECISIONS AND ACTIONS TAKEN BASED ON THE SERVICES.

**9.3 Safety Disclaimer.** WHILE THE SERVICES INCLUDE SAFETY KEYWORD DETECTION AND LOCKOUT/TAGOUT (LOTO) WARNINGS, THESE FEATURES ARE SUPPLEMENTAL AIDS AND DO NOT REPLACE CUSTOMER'S OBLIGATION TO MAINTAIN INDEPENDENT SAFETY PROGRAMS, TRAINING, AND PROCEDURES IN COMPLIANCE WITH OSHA, NFPA 70E, AND ALL APPLICABLE SAFETY REGULATIONS.

**9.4 General Disclaimer.** EXCEPT AS EXPRESSLY SET FORTH IN THIS SECTION, THE SERVICES ARE PROVIDED "AS IS" AND PROVIDER DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

---

## 10. Limitation of Liability

**10.1 Cap.** EXCEPT FOR OBLIGATIONS UNDER SECTION 8 (CONFIDENTIALITY) AND SECTION 12 (INDEMNIFICATION), NEITHER PARTY'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT WILL EXCEED THE AMOUNTS PAID OR PAYABLE BY CUSTOMER TO PROVIDER DURING THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY.

**10.2 Exclusion of Consequential Damages.** IN NO EVENT WILL EITHER PARTY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY, REGARDLESS OF WHETHER SUCH PARTY WAS ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

**10.3 Equipment and Safety.** PROVIDER IS NOT LIABLE FOR ANY PERSONAL INJURY, DEATH, EQUIPMENT DAMAGE, PRODUCTION LOSS, OR ENVIRONMENTAL DAMAGE ARISING FROM CUSTOMER'S USE OF OR RELIANCE ON THE SERVICES, INCLUDING BUT NOT LIMITED TO RELIANCE ON MIRA'S DIAGNOSTIC RECOMMENDATIONS OR SAFETY NOTIFICATIONS.

---

## 11. Term and Termination

**11.1 Term.** This Agreement commences on the Effective Date and continues for the initial term specified in the Order Form. The Agreement will automatically renew for successive renewal terms of equal length unless either party provides written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.

**11.2 Termination for Cause.** Either party may terminate this Agreement if the other party materially breaches this Agreement and fails to cure such breach within thirty (30) days after receiving written notice of the breach.

**11.3 Termination for Convenience.** Customer may terminate this Agreement at any time with thirty (30) days' written notice. No refunds will be provided for the remainder of a prepaid term.

**11.4 Effect of Termination.** Upon termination: (a) Customer's access to the Services will cease; (b) Provider will make Customer Data available for export for thirty (30) days following termination; (c) after the export period, Provider will delete Customer Data from its systems within sixty (60) days, except as required by law or as Anonymized Aggregate Data already contributed to the Knowledge Cooperative (which is irreversibly anonymized and cannot be extracted).

---

## 12. Indemnification

**12.1 By Provider.** Provider will defend, indemnify, and hold harmless Customer from and against any third-party claims alleging that the Services infringe such third party's intellectual property rights, and will pay any resulting damages awarded or settlement amounts.

**12.2 By Customer.** Customer will defend, indemnify, and hold harmless Provider from and against any third-party claims arising from: (a) Customer's use of the Services in violation of this Agreement; (b) Customer Data; or (c) Customer's failure to maintain adequate safety programs as described in Section 9.3.

**12.3 Procedure.** The indemnified party will: (a) promptly notify the indemnifying party; (b) grant the indemnifying party sole control of the defense and settlement; and (c) provide reasonable cooperation at the indemnifying party's expense.

---

## 13. Service Level Agreement

**13.1 Uptime.** Provider will use commercially reasonable efforts to maintain the Services with an uptime of 99.5% measured monthly, excluding scheduled maintenance windows.

**13.2 Scheduled Maintenance.** Provider will provide at least 24 hours' notice of scheduled maintenance that may impact Service availability. Scheduled maintenance windows will be during off-peak hours (10 PM - 6 AM Customer's local time) when possible.

**13.3 Support.** Provider will provide support in accordance with the support terms applicable to Customer's Subscription Tier:

| | Community | Professional | Enterprise | On-Premise |
|---|---|---|---|---|
| Response Time (Critical) | 4 hours | 2 hours | 1 hour | Per contract |
| Response Time (Normal) | 24 hours | 8 hours | 4 hours | Per contract |
| Support Hours | Business hours | Business hours | 24/7 | Per contract |
| Support Channel | Email | Email + Chat | Dedicated Slack/Teams | Per contract |

**13.4 Remedies.** If Provider fails to meet the uptime commitment in any calendar month, Customer may request a service credit equal to 5% of the monthly fee for each full percentage point below the 99.5% target, up to a maximum of 25% of the monthly fee. Service credits are Customer's sole remedy for uptime failures.

---

## 14. Bring Your Own Database (BYOD) and On-Premise

**14.1 BYOD Option.** Enterprise Tier customers may elect to connect the Services to Customer's own PostgreSQL-compatible database instance ("Customer Database"). In such case: (a) Customer is responsible for database provisioning, backup, security, and availability; (b) Provider will provide connection configuration documentation; (c) Provider's uptime SLA applies only to the Provider-operated components of the Services, not to the Customer Database; (d) additional professional services fees apply as specified in the Order Form.

**14.2 On-Premise Deployment.** On-Premise Tier customers receive a containerized deployment package (Docker Compose) that runs the Services entirely on Customer's infrastructure. In such case: (a) Customer is responsible for all infrastructure, including compute, storage, networking, and security; (b) Provider provides software updates, remote troubleshooting support, and documentation; (c) Provider does not have access to Customer Data unless Customer explicitly grants remote access for support purposes; (d) the license is per-facility and annual, as specified in the Order Form.

**14.3 CMMS Integration.** Integration with Customer's existing CMMS (e.g., SAP PM, Maximo, MaintainX, UpKeep, Limble, Fiix) is available as a professional services engagement. Standard connectors are included in Professional Tier and above. Custom integrations are billed at the rates specified in the Order Form.

---

## 15. General Provisions

**15.1 Governing Law.** This Agreement is governed by the laws of the State of Florida, without regard to conflict of laws principles.

**15.2 Dispute Resolution.** Any dispute arising under this Agreement will first be submitted to good-faith negotiation between senior executives. If not resolved within thirty (30) days, the dispute will be submitted to binding arbitration in accordance with the rules of the American Arbitration Association, conducted in Florida.

**15.3 Assignment.** Neither party may assign this Agreement without the other's prior written consent, except in connection with a merger, acquisition, or sale of all or substantially all of the assigning party's assets.

**15.4 Force Majeure.** Neither party will be liable for delays or failures in performance resulting from circumstances beyond its reasonable control, including acts of God, natural disasters, pandemic, war, terrorism, government actions, or internet service failures.

**15.5 Entire Agreement.** This Agreement, together with all Order Forms, DPAs, and referenced policies, constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, and agreements.

**15.6 Amendments.** This Agreement may be amended only by a written instrument signed by both parties, or by Provider updating its standard terms with sixty (60) days' notice to Customer.

**15.7 Severability.** If any provision of this Agreement is found to be unenforceable, the remaining provisions will continue in full force and effect.

**15.8 Notices.** All notices will be in writing and delivered to the addresses specified in the Order Form.

---

## Exhibit A: Data Taxonomy

The following table defines the categories of data processed by the Services and their treatment under each Subscription Tier:

| Data Category | Examples | Community Tier | Professional+ |
|---|---|---|---|
| Equipment Identifiers | Asset tag, serial number, nameplate data | Stored; NOT shared | Stored; isolated |
| Facility Identifiers | Plant name, address, area/line designations | Stored; NOT shared | Stored; isolated |
| Personnel Identifiers | Technician names, user IDs, chat handles | Stored; NOT shared | Stored; isolated |
| Diagnostic Conversations | Tech messages, MIRA responses, photo descriptions | Stored; anonymized patterns extracted | Stored; isolated |
| Work Orders | WO numbers, fault descriptions, resolutions, parts used | Stored; anonymized patterns extracted | Stored; isolated |
| OEM Documentation | Manuals, schematics, parts lists uploaded by Customer | Stored; NOT shared (licensed content) | Stored; isolated |
| Operational Patterns | Fault frequency by equipment class, MTTR by fault type, seasonal trends | Anonymized + contributed to Knowledge Cooperative | NOT contributed |
| Sensor Data | Vibration, temperature, current readings | Stored; anonymized benchmarks extracted | Stored; isolated |

---

## Exhibit B: Order Form Template

| Field | Value |
|---|---|
| Customer Legal Name | _________________________ |
| Customer Contact | _________________________ |
| Customer Email | _________________________ |
| Subscription Tier | Community / Professional / Enterprise / On-Premise |
| Number of Facilities | _________________________ |
| Number of Authorized Users | _________________________ |
| Monthly Subscription Fee | $_________________________ |
| Setup/Configuration Fee | $_________________________ (one-time) |
| CMMS Integration | Atlas / MaintainX / UpKeep / Limble / Other: _______ |
| Initial Term | 12 months / 24 months / Monthly |
| Payment Terms | Monthly / Annual (prepaid) |
| Data Sharing Consent | [ ] I consent to Anonymized Aggregate Data participation (Community Tier) |
| Effective Date | _________________________ |

**Customer Signature:** _________________________  **Date:** _____________

**Provider Signature:** _________________________  **Date:** _____________

---

*CONFIDENTIAL — FactoryLM, Inc. — Draft for Legal Review*
*Document Version: 1.0 | Date: April 24, 2026*
