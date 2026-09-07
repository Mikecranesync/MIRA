# Button walk — unified shell @ 412x915

190/190 PASS

| Scenario | Control | Expected | Actual | Verdict |
|---|---|---|---|---|
| machine-ask | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| machine-ask | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| machine-ask | Work | acts; any layer unwinds one step | view changed | PASS |
| machine-ask | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| machine-ask | Machine | acts; any layer unwinds one step | view changed | PASS |
| machine-ask | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-ask | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-ask | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-ask | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-ask | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| grounded-answer | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| grounded-answer | Work | acts; any layer unwinds one step | view changed | PASS |
| grounded-answer | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| grounded-answer | Machine | acts; any layer unwinds one step | view changed | PASS |
| grounded-answer | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| grounded-answer | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| grounded-answer | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| grounded-answer | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| grounded-answer | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| attachments | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| attachments | Work | acts; any layer unwinds one step | view changed | PASS |
| attachments | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| attachments | Machine | acts; any layer unwinds one step | view changed | PASS |
| attachments | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| attachments | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| attachments | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| attachments | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| attachments | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| project-tree | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| project-tree | Work | acts; any layer unwinds one step | view changed | PASS |
| project-tree | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| project-tree | Machine | acts; any layer unwinds one step | view changed | PASS |
| project-tree | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| project-tree | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| project-tree | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| project-tree | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| project-tree | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| work-run | Ask | acts; any layer unwinds one step | view changed | PASS |
| work-run | Work | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| work-run | Share Shift handoff | acts; any layer unwinds one step | view changed | PASS |
| work-run | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| work-run | Machine | acts; any layer unwinds one step | view changed | PASS |
| work-run | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| work-run | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| work-run | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| work-run | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| work-run | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| machine-evidence | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| machine-evidence | Work | acts; any layer unwinds one step | view changed | PASS |
| machine-evidence | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| machine-evidence | Machine | acts; any layer unwinds one step | view changed | PASS |
| machine-evidence | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-evidence | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-evidence | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| machine-evidence | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| machine-evidence | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| safety-stop | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| safety-stop | Work | acts; any layer unwinds one step | view changed | PASS |
| safety-stop | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| safety-stop | Machine | acts; any layer unwinds one step | view changed | PASS |
| safety-stop | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| safety-stop | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| safety-stop | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| safety-stop | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| safety-stop | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| error-retry | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| error-retry | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| error-retry | Work | acts; any layer unwinds one step | view changed | PASS |
| error-retry | Retry | acts; any layer unwinds one step | view changed | PASS |
| error-retry | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| error-retry | Machine | acts; any layer unwinds one step | view changed | PASS |
| error-retry | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| error-retry | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| error-retry | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| error-retry | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| offline-sync | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| offline-sync | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| offline-sync | Work | acts; any layer unwinds one step | view changed | PASS |
| offline-sync | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| offline-sync | Machine | acts; any layer unwinds one step | view changed | PASS |
| offline-sync | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| offline-sync | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| offline-sync | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| offline-sync | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| offline-sync | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| long-history | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| long-history | Work | acts; any layer unwinds one step | view changed | PASS |
| long-history | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| long-history | Machine | acts; any layer unwinds one step | view changed | PASS |
| long-history | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| long-history | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| long-history | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| long-history | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| long-history | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| enterprise-inspector | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| enterprise-inspector | Work | acts; any layer unwinds one step | view changed | PASS |
| enterprise-inspector | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| enterprise-inspector | Machine | acts; any layer unwinds one step | view changed | PASS |
| enterprise-inspector | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| enterprise-inspector | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| enterprise-inspector | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| enterprise-inspector | Launch 2 Reliability | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | LSM Drive System | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Launch 2 Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Drive A | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Launch 2 Drive B | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Brake System | acts; any layer unwinds one step | navigation true->false | PASS |
| enterprise-inspector | Recurring findings | acts; any layer unwinds one step | navigation true->false | PASS |
| general-ask | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| general-ask | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| general-ask | Work | acts; any layer unwinds one step | view changed | PASS |
| general-ask | How is preload measured? | acts; any layer unwinds one step | view changed | PASS |
| general-ask | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| general-ask | Machine | acts; any layer unwinds one step | view changed | PASS |
| general-ask | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| general-ask | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| general-ask | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| general-ask | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| empty | Open navigation | acts; any layer unwinds one step | navigation false->true | PASS |
| empty | Ask | acts; any layer unwinds one step | no-op by design (already selected) | PASS |
| empty | Work | acts; any layer unwinds one step | view changed | PASS |
| empty | Add attachment | acts; any layer unwinds one step | opened a layer (0->1); Escape unwound exactly one | PASS |
| empty | Machine | acts; any layer unwinds one step | view changed | PASS |
| empty | Voice | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| empty | Send | acts; any layer unwinds one step | no-op by design (disabled) | PASS |
| empty | Close navigation | acts; any layer unwinds one step | navigation true->false | PASS |
| empty | New chat | acts; any layer unwinds one step | no-op by design (disabled) | PASS |