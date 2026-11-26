# What's new in MockDesk

## v28: Load test, up to 10,000 students
**Clean setup.** One page in four steps: pick a scenario card, set size and length, switch on what students do (settings appear under each switch), set pass/fail targets. Timing, safety stop and notes sit under Advanced. A bar at the bottom shows the size, estimated requests and any blockers.
**Scenarios.** Ten ready-made cards (quick check, normal class, live exam start, submit rush, find my limit, staircase, two batches, busy site, soak, biggest possible) plus cards sized from your real data: all your students, and your biggest batch.
**Your limits.** Most students, longest test, warm-up, staircase steps and custom requests are no longer fixed. Change them under Limits (ceiling 10,000 students, 24 hours). Requests can also give up after your own timeout.
**Live view.** Students active, requests per second, p95 and p99, failures and requests waiting, resource meters, charts with p99 and in-flight, a live feed with milestones, new error types, recoveries and warnings (filter All, Problems, Good), and a failures-by-type list. Setup of large tests shows progress.
**Big tests.** Users are created in slices, latency samples are capped so memory stays flat, and the preflight now checks generator memory, open-file limit and setup time.
**Baseline.** Mark any saved result as your baseline. Every later result shows a banner comparing it with the baseline. Reports also download as CSV from the server.

## v27: Full-platform QA sweep
Checked every admin, teacher, student and sign-in page on desktop, phone and dark mode.
**Fixed.** Mock cards showed blank section bars ("0/"); the Audit log's When column wrapped into six lines and long details ran off the table; the Server tools checks list put each dot on its own line; the Support inbox filter chips were clipped ("Al"); form fields with hints sat out of line with their neighbours (batch invite, Topper tricks); the Exams page repeated the same "edit config" line twice; teacher Doubts and Batch health pages had the wrong breadcrumb ("Batch"); the admin search box showed a garbled letter on phones; Help was indented differently from other admin pages; the Administrators filter row wrapped awkwardly.

## v26: Help redesign and data answers
**Clean Help.** One search box with type-ahead, quick-check pills, and four idea tabs (People, Mocks and results, Platform, How do I…). Answers appear as a simple question-and-answer thread; the busy side panels are gone and "Browse all topics" is one click away at the bottom.
**Ask for data.** Help now reads live data in plain words: profiles for any student, teacher, editor or admin (scores, trend, batches, tickets, recent activity); top and lowest students, inactive or never-started students, new sign-ups, who is online; teachers, staff and admins; batches and batches without a teacher; the hardest or most attempted mock; tests finished today or this week; open tickets and reports; doubts; certificates; failed sign-ins; what admins did recently; a platform overview. How-to questions still get the step-by-step guide. Test accounts are never counted.
**Tables.** Sort by any column, filter long lists, copy, download CSV, refresh, and click a row to open the full page.

## v25: Load test rework
**Fixes.** Limits raised (up to 1000 students, 15 minutes). Measurement no longer loads the server it is measuring (light live poll, cached mock list). Integrity pings stop after a student submits, so they no longer show as false errors. Sign-in and sign-up no longer block the server while hashing passwords.
**New patterns.** Staircase (equal steps) and Waves (a big start, then a second wave at half time), plus a warm-up period that is left out of the results.
**New student actions.** Section moves, tab-switch reports, home page visits; custom requests can now be GET or safe POST/PUT with a body and `{attempt}`/`{question}` placeholders.
**Pass/fail targets.** Set limits for p95, error rate, throughput, CPU, memory, event-loop lag and DB write time; every report shows what passed and failed, and trends are shown across saved tests.
**Preflight.** The setup page explains problems before you start (blockers stop Start, warnings do not) and estimates requests, rate and database growth.
**Sign-in speed check.** Times real password checks and estimates how long N students take to sign in together.

## v24: Batch health, Doubt desk, mock reminders and certificates
**Batch health (Students > Batch health; teachers: Health).** Every student in a batch is ranked Needs attention, Keep an eye or On track from score drops, days since last seen, overdue assignments, very low averages and "never started". Tick students and Nudge them in one click: a fitting default message per student, or your own. One nudge per student per day.
**Doubt desk (students: Ask a teacher on the review page; teachers: Doubts; admins: Messages > Doubt desk).** Teachers see the question, the right answer and what the student chose, then reply. Tick "show to others" and the answer appears under that question for everyone who reviews it. Students are notified; limits are 5 waiting and 10 a day.
**Scheduled mock reminders (Messages > Reminder rules > Scheduled mocks).** Mocks with an opening time remind students who have not taken them, 1 day and 1 hour before. Live tests nudge students who have not started a few minutes after opening. Each reminder can be switched off, and the page shows what was sent.
**Certificates (Students > Certificates; students: Profile).** Completion (finish N different mocks) and Merit (score at least X% in a mock) are issued automatically. Each has a code and a public page (/c/CODE) that proves it is genuine, with Print or save as PDF, Download image and WhatsApp sharing. Admins set the rules, the name and signer, give special certificates by hand, and withdraw or restore any certificate.

## v23: Motion pass
**Loading.** A thin glowing progress line at the top follows real requests and page changes. The logo tick draws itself while the app boots or a page loads. Admin pages show a skeleton (stat tiles and a table shimmering) instead of the word "Loading", and only after 150 ms so quick loads never flash. Other "Loading…" lines get bouncing dots.
**Feel.** Admin pages ease in on every route change, cards rise in one after another, and table rows slide in. Stat numbers count up. Buttons press down and spring back, stat cards lift on hover, dialogs pop with a spring. Toasts slide in with a tick that pops and a timer bar that shrinks.
Everything switches off for people who ask their device for reduced motion.

## v22: Administrators, Site configuration, Server tools and Help
**Settings > Administrators** is rebuilt: live list with filters and search, Invite by email or phone, Manage (role, presets or ticked areas), Remove access, per-person Activity, Lock/Unlock/Sign out, and Rules (admin cap, notify admins, default preset, idle-staff flag and one-click lock). **Site and limits** is now **Site configuration**. **Exam pattern** is removed. **Server > System** is merged into **Server tools > Health and restart**. **Insights > Copy check** is removed. **Help** gets quick-check tiles, a page finder, new topics and live answers about admins; old page names in Help were fixed.

## v21: Help assistant, topper tricks, stamina curve and load simulator
**Help (top bar and Help in the side menu).** Ask anything about the platform in plain words ("how do I lock a teacher account?", "how many students can my server handle?"). You get the answer, checkable steps, a button that opens the right page, related questions and thumbs up/down. It understands typos, answers live questions from your data (student counts, who is online, disk space, last backup, open tickets, platform status), can show help for the page you came from, and keeps a "Missing answers" list of questions it could not answer so you can see what is unclear. It works offline: nothing is sent to an outside service.
**Topper Trick Corner (review page).** Students in the top 10% of a mock (or teachers) can post a one-line "how I solved this in 20 seconds" shortcut under a question they got right. Others upvote, report, and teachers add a Teacher Verified badge. Three reports hide a tip automatically; authors are notified of verification and upvote milestones. Teachers manage tips at Teacher > Tricks; admins at Questions > Tricks, where the rules (top %, minimum students, limits) can be changed. A feature switch turns it off.
**Stamina curve and panic streaks (result page).** Shows accuracy and time per question across the test, compares the first half with the final 20 minutes, finds runs of 3+ skipped or missed questions, counts the marks lost to them, and gives a plain verdict with tips.
**Load and capacity simulator (Server > Server tools > Load test).** Pick how many students (50, 100, 250, 500 or your own), length, autosave interval and which mock to copy. It runs real requests against the live server with temporary students on a hidden test, with live CPU, memory, disk, database write time and response time charts, then a verdict, advice and a downloadable report. It stops itself if errors, memory, disk or freezes cross safety limits, and deletes everything it created. Run it when no exam is live.
**Load test, second round.** More control: scenarios (small class, big batch, live exam, stress, find my limit), three traffic shapes (steady, all at once, gradual climb), and a More settings panel for autosave timing, answers per save, marked-for-review, progress checks, result opening, the submit window, the failure stop limit, a name and a note. Save your own presets. **Every result is saved** (last 15, plus any you pin) and two can be **compared side by side** with a plain verdict, a change table that ignores tiny differences, and overlaid charts. Results are easier to read: a 0-100 health score, an "in plain words" summary, a scorecard that explains each measure, the first thing to give (the bottleneck), a measured limit from the gradual climb with a response-time-by-students chart, a "what happened" timeline, an exam planner that scales the numbers to a bigger crowd, and CSV download. **Test anything you want.** A new "What do students do?" panel switches each action on or off with its own rate: autosave, progress checks, browsing other pages while testing, submit, open the result, the review page, PDF report download, plus extra students who only browse (dashboard, inbox, mock list and 11 more pages you tick) and up to 6 custom read-only pages of your own (use `{attempt}` for the student's test id). The live screen shows a per-action table, the report lists every action separately, and a page you added that returns errors is reported on its own instead of marking the server overloaded. The setup screen has a Start bar that stays in view with a request estimate, and a Reset to defaults button.
Fixed in this round: at the end of a test every virtual student used to save at the same instant, which made the last seconds look overloaded, and the account set-up burst was counted as exam CPU. Both are removed, so results now reflect the steady load. The live view shows a Healthy / Slowing down / Struggling badge and an event feed.

## v20: Team activity and branding
**Team activity (Settings > Team activity).** Everyone with admin, staff or teacher access in one table: active now, devices signed in, changes in the last 7 days and status. Click a name to see what they changed, the devices they are signed in on and their recent sign-ins. Sign a person out, lock or unlock their account in one click, or lock every staff and teacher account at once if you suspect a takeover (admins are never affected, and you cannot lock yourself or the last admin). Repeated failed sign-ins on a staff account raise an alert.
**Branding (Settings > Site and limits).** Upload your logo, pick a brand colour and set the footer line. The logo shows in every header and as the browser tab icon, and the colour is used for buttons and links on the student, teacher and public pages. Too-light colours are refused so button text stays readable. The admin console keeps its own look.

## v19: Alerts, question quality, auto-built mocks and teacher assignments
**Alerts (Server > Alerts, and the bell in the top bar).** The platform now watches itself: low disk space, a spike in server errors, a failed or missing backup, a failed or paused background job, and the server not responding. Each shows on the dashboard and under the bell, can be marked read or hidden for a day, and clears itself when the problem goes. Optionally the same alerts are sent to your email or WhatsApp, once per problem. Thresholds are editable.
**Question quality loop.** Questions that nobody got right, or that most toppers got wrong, are flagged next to the old flags and raise one alert asking you to review or replace them.
**Mock builder.** Filter by topic, preview before saving, and schedule the new mock to open later. New: a weekly auto-build that makes a balanced draft (or scheduled) mock from the bank and alerts you when it is ready or when the bank is too thin.
**Teacher assignments.** Teachers set a mock or practice sets for a batch with a due date, see who has not done it, and send a reminder. Students see it on their dashboard and get a reminder a day before and when it is past due. Admins see all assignments under Students > Assignments.

## v18: Admin tools
Server page with restart, database tools, restore from backup, log viewer and version info. Release calendar. Support inbox for students and staff. View as student (read-only). Download or erase one person's data. More bulk actions on students. Devices signed in per user.

## v17: Teacher portal and navigation
New teacher dashboard (activity, needs attention, top performers, weak topics). Back and Forward buttons and breadcrumbs on every console. Built-in admin address.

## v16: Student dashboard
A calmer, balanced dashboard with a next-step card, mocks list, focus topics and practice.

## v14: Keys and settings in the admin panel
Email, SMS, WhatsApp and AI keys are typed in the admin panel and stored encrypted.

## v13: Admin menu
Eight hubs instead of thirty tabs, and a new admin dashboard.

## v12: Control room
Maintenance mode, feature switches, sign-up rules, blocked addresses, live monitoring, background jobs and sign-in log.
