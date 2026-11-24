# What's new in MockDesk

## v21: Help assistant, topper tricks, stamina curve and load simulator
**Help (top bar and Help in the side menu).** Ask anything about the platform in plain words ("how do I lock a teacher account?", "how many students can my server handle?"). You get the answer, checkable steps, a button that opens the right page, related questions and thumbs up/down. It understands typos, answers live questions from your data (student counts, who is online, disk space, last backup, open tickets, platform status), can show help for the page you came from, and keeps a "Missing answers" list of questions it could not answer so you can see what is unclear. It works offline: nothing is sent to an outside service.
**Topper Trick Corner (review page).** Students in the top 10% of a mock (or teachers) can post a one-line "how I solved this in 20 seconds" shortcut under a question they got right. Others upvote, report, and teachers add a Teacher Verified badge. Three reports hide a tip automatically; authors are notified of verification and upvote milestones. Teachers manage tips at Teacher > Tricks; admins at Questions > Tricks, where the rules (top %, minimum students, limits) can be changed. A feature switch turns it off.
**Stamina curve and panic streaks (result page).** Shows accuracy and time per question across the test, compares the first half with the final 20 minutes, finds runs of 3+ skipped or missed questions, counts the marks lost to them, and gives a plain verdict with tips.
**Load and capacity simulator (Server > Server tools > Load test).** Pick how many students (50, 100, 250, 500 or your own), length, autosave interval and which mock to copy. It runs real requests against the live server with temporary students on a hidden test, with live CPU, memory, disk, database write time and response time charts, then a verdict, advice and a downloadable report. It stops itself if errors, memory, disk or freezes cross safety limits, and deletes everything it created. Run it when no exam is live.
**Load test, second round.** More control: scenarios (small class, big batch, live exam, stress, find my limit), three traffic shapes (steady, all at once, gradual climb), and a More settings panel for autosave timing, answers per save, marked-for-review, progress checks, result opening, the submit window, the failure stop limit, a name and a note. Save your own presets. **Every result is saved** (last 15, plus any you pin) and two can be **compared side by side** with a plain verdict, a change table that ignores tiny differences, and overlaid charts. Results are easier to read: a 0-100 health score, an "in plain words" summary, a scorecard that explains each measure, the first thing to give (the bottleneck), a measured limit from the gradual climb with a response-time-by-students chart, a "what happened" timeline, an exam planner that scales the numbers to a bigger crowd, and CSV download. Fixed in this round: at the end of a test every virtual student used to save at the same instant, which made the last seconds look overloaded, and the account set-up burst was counted as exam CPU. Both are removed, so results now reflect the steady load. The live view shows a Healthy / Slowing down / Struggling badge and an event feed.

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
