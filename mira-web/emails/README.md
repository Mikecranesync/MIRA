# Email lifecycle

The current offer is in `../../docs/product/current-pilot-offer.md`. `beta-welcome.html` now directs legacy interest registrations to the Hub application and does not imply approval. Hub registration records the application and notifies the owner through `pilot-funnel.ts`; it does not currently send an applicant confirmation email. Google OAuth does not pass through that registration hook; owner notification/attribution parity remains a separate gap.

The legacy day-1 through day-10 nurture/payment sequence is retained in `mailer.ts` for historical inspection but its exported schedule is empty. It must not send unsupported capability claims or day-seven payment demands during the free pilot campaign. Legacy `beta-payment`, `beta-reminder`, Loom and social-proof templates are historical, not current campaign copy. Payment-triggered receipts for existing paid customers and magic-link delivery retain their existing behavior. No email was sent by this change.
