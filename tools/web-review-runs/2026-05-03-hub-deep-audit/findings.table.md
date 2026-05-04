| #  | Sev | Route                  | Title                                           | Dup?           | File? |
|----|-----|------------------------|-------------------------------------------------|----------------|-------|
|  1 | 🔴 | /cmms                  | 503 on /api/cmms/stats/                         | -              | NEW   |
|  2 | 🔴 | /knowledge             | 500 on /api/uploads/                            | -              | NEW   |
|  3 | 🟠 | (site-wide)            | Console error: [hubDataProvider] NEXT_PUBLIC_PI | -              | NEW   |
|  4 | 🟠 | (site-wide)            | 404 on /admin/users/                            | -              | NEW   |
|  5 | 🟠 | (site-wide)            | 1 button(s) without accessible name             | -              | NEW   |
|  6 | 🟠 | /admin/roles           | Initial page load returned 404                  | -              | NEW   |
|  7 | 🟠 | /admin/users           | Initial page load returned 404                  | -              | NEW   |
|  8 | 🟠 | /magic/                | Page has no H1                                  | -              | NEW   |
|  9 | 🟡 | (site-wide)            | Missing canonical link                          | -              | NEW   |
| 10 | 🟡 | (site-wide)            | Incomplete Open Graph tags                      | -              | NEW   |
| 11 | 🟡 | (site-wide)            | 6 clickable(s) did not respond within 2s        | -              | NEW   |
| 12 | 🟡 | (site-wide)            | Heading levels skipped                          | -              | NEW   |
| 13 | 🟡 | (site-wide)            | 5 tap target(s) < 44px (mobile)                 | -              | NEW   |
| 14 | 🟡 | /login                 | Lighthouse performance score 73                 | -              | NEW   |
| 15 | 🟡 | /__webreview_404_17778 | Random nonexistent path returned 308 instead of | GH#956 CRA-26  | skip  |
| 16 | 🟡 | /sitemap.xml           | Missing or invalid /sitemap.xml                 | GH#954 CRA-27  | skip  |
| 17 | 🟢 | (site-wide)            | Missing twitter:card                            | -              | NEW   |
| 18 | 🟢 | /__webreview_404_17778 | 404 page has no home link                       | GH#662         | skip  |
| 19 | 🟢 | /robots.txt            | /robots.txt does not reference a sitemap        | GH#955 CRA-28  | skip  |
