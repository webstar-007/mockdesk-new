# 04 · Updating and daily use

## Change the app and put it live
1. Change files inside `app/` (a new `mockdesk.zip` from the developer replaces the contents of `app/`).
   Unzip so the files sit **directly inside** `app/` (not in `app/mockdesk/`). Do not copy `node_modules`, `data` or `*.db` files.
2. In the VS Code terminal:
   ```
   git add -A
   git commit -m "what I changed"
   git push
   ```
3. Jenkins > **Build with Parameters** > `ACTION = update` > **Build**. It takes about 2 minutes.

Student data (accounts, attempts, uploaded images, backups) is **never** touched by an update.
New database columns are added automatically when the app starts.

## If something goes wrong
| What you see | What to do |
|---|---|
| The build fails while installing or building | The old version keeps running. Read the red stage in the Jenkins log, fix it, run `update` again |
| The new version starts but behaves badly | Fix the code and run `update` again. Or restore a backup (Admin > Data and backup shows the steps) |
| New page does not appear after `update` | Hard refresh (Ctrl+Shift+R) or open a private window. Check `http://<ip>/api/health` |
| `deploy` stops with "key pair already exists" | An old run left things behind. Run `destroy`, then `./scripts/check-destroyed.sh`, then `deploy` |
| You forgot to `git push` | Jenkins deploys what is on GitHub, not what is on your laptop. Push, then run again |

## See the server log (rare)
Everything useful is on Admin > System. If you need the raw log, SSH in from the project folder:
```
ssh -i keys/mockdesk-demo.pem ubuntu@<ip> "sudo journalctl -u mockdesk -n 100 --no-pager"
```

## Daily admin work (all in the browser at `/admin`)
| I want to | Where |
|---|---|
| add many students from a sheet | Import students |
| give a teacher or helper limited access | Users > person > Change role > Staff |
| send a message or schedule one | Messages |
| fix a wrong answer key | Question bank (scores of finished tests are corrected automatically) |
| look for copying | Copy check, Integrity |
| download results, or make a backup | Data and backup |

## Stop paying
Jenkins > **Build with Parameters** > `ACTION = destroy`, then `./scripts/check-destroyed.sh`. Download a backup first if you want the data.

## Keys and settings from the admin panel
You no longer need to put email, SMS, WhatsApp or AI keys in server files. Open **Admin > Server > Integrations**, type them in, press Save, then press the test button. They apply immediately and survive updates.
They are saved encrypted in the database. The encryption key is the file `data/.mockdesk-key` on the server. Keep a copy of it with your backups. If you ever restore a database without it, just type the keys in again.
