# 05 · Go-live checklist: from test site to real students

The kit starts in **test mode**. Real students need these steps. Do them in order.

## 1. Pick the server size
Use `03-COST-GUIDE.md`. Edit `instance_type` and `disk_gb` in `terraform/variables.tf`, push, run **deploy**.

## 2. Domain and HTTPS
Real sign-in cookies, push notifications and the install-as-app feature work only over **HTTPS**.
1. Buy a domain (about ₹1,000 a year) and point an **A record** to the server's fixed IP (shown at the end of the deploy log).
2. Put HTTPS in front of the app. Two common ways:
   - **Caddy** on the same server (free certificate, automatic renewal). Caddy listens on 443 and passes traffic to the app on port 80.
   - **CloudFront + a free AWS certificate** in front of the server (also speeds up site files).
3. Open port **443** in `terraform/main.tf` (add one more `ingress` block like the port 80 one) and run **deploy**.
4. In `ansible/roles/mockdesk/defaults/main.yml` set `app_env: production`, `trust_proxy: true` and `public_url: "https://your-domain"`, push, run **update**.

> HTTPS is **not built into this kit yet**. This step is a manual change. Ask for it to be automated when you are ready.

## 3. Real sign-in codes
Pick the cheapest that works for you (prices in `03-COST-GUIDE.md`):
- **Email** (recommended): set `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `mail_from` in `defaults/main.yml` (Amazon SES, Brevo, Zoho, Resend all work).
- **SMS** and **WhatsApp**: set in the server environment, see `app/.env.example`.
Then in the Admin page open **System** and fix everything shown in orange.

## 4. Admin accounts
Put your email in `app/admins.txt` (one per line, or `email editor` for a content-only staff member) **before** the first deploy.
Whoever signs up with that email becomes an admin. Later you can change roles in Admin > Users.

## 5. Backups
Admin > **Data and backup**: leave automatic backups on (daily, last 7 kept). Once a week, download one and keep it somewhere safe outside AWS.
A lost server takes its own backups with it.

## 6. Rehearse before a big exam
1. Create about 20 test accounts (Admin > Import students).
2. Open a test on a phone and a laptop at the same time. Answer, reload the page, switch off the Wi-Fi for 20 seconds and switch it on.
3. Submit and check the score and the PDF report.
4. Look at Admin > System and Admin > Live tests while it runs.
5. For more than 1,000 people at once, ask a few hundred real users to join a trial test a week before.

## 7. After the exam
Download the results (Admin > Data and backup), then set the server back to a cheaper size.
