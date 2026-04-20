# Bravonode Prompt — Spoken Version for TTS

Hi Claude. You are running on the Bravo Mac Mini. You have a checkout of the MIRA repository. Your job today is to build Phase One of the QR channel chooser feature. Only Phase One. Not Two through Five.

Start by reading two files in the repository. The first is the plan document at the path docs, superpowers, plans, two thousand twenty six dash oh four dash nineteen dash QR channel chooser plan. The second is the detailed prompt document at docs, agent prompts, bravonode QR chooser phase one. Everything you need is in those two files. Read them both before you touch any code.

Here's the overview so you know where you're headed. Right now, when a technician scans a QR sticker on a machine, our server returns a raw JSON error if the technician isn't logged in. That's a dead end. The industry standard way to fix this, used by every major CMMS product, is a two-lane design. Lane one is a guest form for operators who aren't paying users — they scan, they type a problem description, we email the plant admin. Lane two is the authenticated path for technicians who have accounts, and they get routed into whichever chat channel their plant admin picked, either Open WebUI in a web browser, or our Telegram bot on their phone.

Your job in Phase One is to build four pieces. First, a new database table called tenant channel config, where the admin's channel choices live. Second, another new database table called guest reports, where operator fault reports get saved. Third, modify the scan route so that unauthenticated scans render a chooser page with thumb-friendly buttons for each enabled channel. Fourth, a new admin settings page where the plant admin picks which channels they want enabled. You'll also add a guest report form page, an email template for the admin notification, and tests for all of it.

Rules. Work on the branch called feat slash QR channel chooser. Don't switch branches. Verify your branch at the start, and before every commit. If you find yourself on the wrong branch, stop and write what happened.

Write the failing test first, then the implementation, then confirm green. Use the existing test patterns — look at how m dot test dot t-s and qr tracker dot test dot t-s handle the j-w-t secret fallback and tenant cleanup. Copy that exact pattern.

When you read from the database, use the neon tagged template function. When you write a multi-statement transaction, use the new Client constructor with begin and commit. This matches how the existing scan route and admin pages already work. For UUID columns, remember to add the cast u-u-i-d syntax because the neon driver sends strings as text by default.

Don't add any new dependency without checking it's M-I-T or Apache two point zero licensed. That's a hard project constraint.

Don't build a new chat interface. Don't modify mira pipeline. Don't modify the Telegram or Slack bots — those are Phase Two and Four. Don't touch the existing email templates like beta welcome or beta activated; just add new ones.

For the development environment, wrap all your test and migration commands in doppler run dash dash project factory L-M dash dash config dev dash dash. That injects the database connection string and other secrets.

Number your migrations starting at oh oh four tenant channel config, and oh oh five guest reports. Make them idempotent — use create table if not exists, and create index if not exists. Wrap them in begin and commit. At the end of oh oh four, backfill every existing tenant with a default configuration of Open WebUI plus guest reports enabled, so existing customers keep working the way they do today.

Preserve two security properties. First, the scan route must remain constant time for tenant resolution — always issue the same database query, branch only on the result, never on the auth state or the cookie. Second, the not-found HTML must remain byte-identical for cross-tenant misses and nonexistent tags. This prevents an attacker from probing which tags exist in which plants.

Commit in small logical chunks. Conventional commit format, the feat colon or fix colon style. Include the Co-Authored-By trailer with Claude Opus four point seven in parentheses. Push after each chunk so the human can follow progress.

When you finish, open a draft pull request from your branch against main. Not against the QR asset tagging branch — against main directly. Title starts with feat open parenthesis QR chooser close parenthesis colon. In the PR body, list each acceptance criterion with a checkbox, and paste the actual test count output, the real N pass M fail line. Do not claim success based on the absence of errors. Read the summary line carefully.

Add the pull request to the Kanban board number four, owner Mikecranesync. Do not mark it ready for review — the human promotes it after they read the diff. Do not merge it yourself under any circumstances.

If you get stuck, try up to three different approaches. After three failed attempts on the same problem, stop. Write a diagnosis document at docs, superpowers, plans, blockers, with today's date and the problem name. Commit it. Push it. Tag the P-R with a blocked label. Do not delete work. Do not force push. Do not skip tests to make continuous integration pass.

Total estimated effort is six to ten hours. You should be able to ship today or early tomorrow.

That's the job. Read the plan document first, then the prompt document, then start writing tests, then code, then commit, then open the draft P-R. Report back with commit S-H-As, test counts, and the P-R URL when you're done.
