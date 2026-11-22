# MockDesk one click

Build a complete MockDesk exam-practice website on AWS with **one click**, change it with **one more click**, and delete it with **a third click**.

```
You push to GitHub -> Jenkins -> Terraform (server, firewall, fixed IP) -> Ansible (Node.js, app) -> http://<ip>
```

## The three actions (Jenkins > Build with Parameters)
| ACTION | What it does | Time |
|---|---|---|
| `deploy` | Builds the AWS server and releases the app. Safe to run again | 8 to 10 min |
| `update` | Puts your new code on the existing server. Student data is kept | 2 min |
| `destroy` | Deletes everything on AWS | 3 to 5 min |

## Start here
1. `./scripts/tools.sh --install` checks the tools and installs missing ones (it asks first).
2. Follow **[docs/02-SETUP-GUIDE.md](docs/02-SETUP-GUIDE.md)** (GitHub, Jenkins job, the click).
3. After `destroy`, run `./scripts/check-destroyed.sh` to prove nothing is left.

## Scripts
| Script | What it does |
|---|---|
| `scripts/tools.sh` | Checks Git, Terraform, Ansible, AWS CLI, Java, Jenkins. `--install` asks before installing each missing one, `--yes` installs without asking |
| `scripts/vscode-extensions.sh` (`.bat` on Windows) | Installs every VS Code extension listed in `.vscode/extensions.json` |
| `scripts/check-ready.sh` | Is AWS login, Jenkins and Git ready? Changes nothing |
| `scripts/check-destroyed.sh` | After `destroy`: is every AWS resource gone? |

## Documents
| Document | Read it when |
|---|---|
| [01-INFRASTRUCTURE](docs/01-INFRASTRUCTURE.md) | you want to understand what is built (with diagrams) |
| [02-SETUP-GUIDE](docs/02-SETUP-GUIDE.md) | you set it up for the first time |
| [03-COST-GUIDE](docs/03-COST-GUIDE.md) | you want to know the monthly cost and which server to pick (1,000 online, 5,000 test takers, 1 lakh email codes, ...) |
| [04-UPDATING-AND-DAILY-USE](docs/04-UPDATING-AND-DAILY-USE.md) | you change the app, or something goes wrong |
| [05-GO-LIVE-CHECKLIST](docs/05-GO-LIVE-CHECKLIST.md) | you move from a test site to real students |

## What is in the folders
| Folder | What it is |
|---|---|
| `app/` | The MockDesk website and server. **Your code lives here.** See `app/README.md` |
| `terraform/` | The AWS server, firewall, fixed IP and SSH key. Settings are in `variables.tf` |
| `ansible/` | One role: install Node.js, create the service, release a version, check it |
| `scripts/` | The helper scripts above |
| `docs/` | The documents above, with `img/` (diagrams) and `diagrams/` (their editable sources) |
| `.vscode/` | VS Code settings and recommended extensions |
| `Jenkinsfile` | The pipeline with the three actions |

## Good to know
- **Jenkins credential:** `aws-creds` (Username with password: AWS access key id and secret key). Default region `us-east-1`.
- **Test setup cost:** about $0.03 per hour (about $22 a month if left on). The server is a `t3.small`. For 1,000 or 5,000 students see the cost guide.
- **One server only.** MockDesk keeps data in a SQLite file, so it runs on one server. Growing means a faster server, not more servers.
- **Plain HTTP** in the test setup. Real students need HTTPS and a real sign-in code provider: `docs/05-GO-LIVE-CHECKLIST.md`.
- **Never committed to Git:** `keys/` (SSH key), Terraform state, `ansible/inventory.ini`, `app/node_modules`, `app/data`, any `.db` file. See `.gitignore`.
- **Your data is safe during `update`.** Only `destroy` removes it. Download a backup first (Admin > Data and backup).
