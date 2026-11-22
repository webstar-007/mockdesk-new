# 02 · Setup guide: from zero to a live website

Follow the steps in order. Each step ends with a **Check** so you know it worked.
Total time: about 40 minutes the first time, of which about 10 minutes is the computer working by itself.

You need: an Ubuntu laptop (or Ubuntu on Windows with WSL), an AWS account, and a GitHub account.

---
## Step 1 · Install the tools (5 to 10 min)
Open a terminal in this project folder and run:
```
./scripts/tools.sh --install
```
The script checks Git, Terraform, Ansible, AWS CLI, Java and Jenkins. For every missing tool it asks **"Install it? [y/N]"**. Type `y`.
(To install everything without questions use `./scripts/tools.sh --yes`. To only look, use `./scripts/tools.sh`.)

**Check:** the last line says `RESULT: ALL REQUIRED TOOLS ARE READY`.

Optional but nice: install the VS Code extensions for this project:
```
./scripts/vscode-extensions.sh
```

---
## Step 2 · Connect your AWS account (5 min)
1. In the AWS website open **IAM > Users > Create user**. Give it **AdministratorAccess**. Create an **access key** for it.
2. In the terminal run `aws configure`. Paste the access key and the secret key. Region: `us-east-1`. Output: press Enter.
3. Run the readiness check:
   ```
   ./scripts/check-ready.sh
   ```

**Check:** the last line says `RESULT: READY`. Fix every line that says `[FAIL]`. `[WARN]` lines are fine.

---
## Step 3 · Put the project on GitHub (5 min)
1. On github.com click **New repository**. Name it `mockdesk-oneclick`. Do not add a README.
2. In the terminal:
   ```
   git init -b main
   git add .
   git status
   git commit -m "MockDesk one click"
   git remote add origin https://github.com/<your-name>/mockdesk-oneclick.git
   git push -u origin main
   ```
   When asked for a password, paste a GitHub **personal access token**.
3. Before you commit, open `app/admins.txt` and add **your email** on a new line. Whoever signs up with that email becomes the admin.

**Check:** `git status` did **not** list `keys/`, `.tfstate`, `inventory.ini` or `node_modules`. The files are visible on github.com.

Why GitHub? Jenkins downloads the project from there. After every change you must `git push`, otherwise Jenkins uses the old version.

---
## Step 4 · Set up Jenkins (10 min, first time only)
1. Open `http://localhost:8080`. If it asks for the first password, run `sudo cat /var/lib/jenkins/secrets/initialAdminPassword`. Choose **Install suggested plugins**.
2. **Manage Jenkins > Credentials > Add credentials**:
   - Kind: **Username with password**
   - Username: your AWS **access key id**
   - Password: your AWS **secret access key**
   - ID: `aws-creds` (exactly this)
3. If your GitHub repository is private, add another credential (ID `github-token`, username = your GitHub name, password = your token).
4. **Dashboard > New Item**. Name `mockdesk-oneclick`. Type **Pipeline**. OK.
5. In the Pipeline section choose:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**, Repository URL: your GitHub address, Credentials: `github-token` (or none if public)
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
6. **Save**.

**Check:** run `./scripts/check-ready.sh` again. The Jenkins lines are all `[ OK ]`.

---
## Step 5 · The one click (10 min)
1. Click **Build Now** once. It stops quickly. Jenkins only learns the parameters. First time only.
2. Click **Build with Parameters**. Choose `ACTION = deploy` and keep `AWS_REGION = us-east-1`.
3. Click **Build**. Open **Console Output** to watch.

**Check:** every stage is green and the log ends with
```
 MOCKDESK IS LIVE:  http://<ip>
```
The same link is shown in the build list.

---
## Step 6 · Open it on your laptop and phone
1. Open the link on your laptop.
2. Open the same link on your phone (Wi-Fi or mobile data both work).
3. Click **Sign up**. Use the email you put in `admins.txt`, with a password. In test mode you do not need a code.
4. Open `<link>/admin` to see the admin console.

**Check:** you can start a mock test on the phone, answer a question and see the timer.

---
## Step 7 · Change something and put it live
1. Edit files in `app/` (or replace them with a new `mockdesk.zip`, see `04-UPDATING-AND-DAILY-USE.md`).
2. ```
   git add -A
   git commit -m "what I changed"
   git push
   ```
3. Jenkins > **Build with Parameters** > `ACTION = update` > **Build**. About 2 minutes.

Students, test attempts and uploaded images are not touched.

---
## Step 8 · Delete everything when you finish
1. Jenkins > **Build with Parameters** > `ACTION = destroy` > **Build**.
2. Run:
   ```
   ./scripts/check-destroyed.sh
   ```

**Check:** the last line says `RESULT: EVERYTHING IS DESTROYED`. Nothing is left that costs money.
Want the data first? Open Admin > **Data and backup** and download a backup before you destroy.

---
## Quick reference
| I want to | Do this |
|---|---|
| Check or install my tools | `./scripts/tools.sh` or `./scripts/tools.sh --install` |
| Install the VS Code extensions | `./scripts/vscode-extensions.sh` |
| Check AWS and Jenkins are ready | `./scripts/check-ready.sh` |
| Build everything | Jenkins: `ACTION = deploy` |
| Put my changes live | `git push`, then Jenkins: `ACTION = update` |
| Delete everything | Jenkins: `ACTION = destroy`, then `./scripts/check-destroyed.sh` |
| Know what it will cost | `docs/03-COST-GUIDE.md` |
| Prepare for real students | `docs/05-GO-LIVE-CHECKLIST.md` |
