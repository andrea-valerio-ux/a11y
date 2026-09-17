# Running the scanner online for free

andryta.com is on HostGator shared hosting, which serves pages and runs PHP but cannot run Node.js or Chrome. So the
site keeps the parts it can do, and GitHub does the heavy part for free:

| Where | What |
| --- | --- |
| **andryta.com/technology/a11y/** (HostGator) | The page with the scan form and the list of runs (`web/index.html`), a small PHP file that starts scans and reports their status (`web/api/index.php`), and a `runs/` folder where finished reports land. |
| **github.com/andrea-valerio-ux/a11y** (private) | The scanner's code and a workflow (`.github/workflows/scan.yml`). Each scan runs on one of GitHub's free Linux machines: it installs Chrome, scans the site, builds the six reports and uploads them to `runs/` by FTP. |

The scanner's own code does not change. A scan takes 3 to 6 minutes from the click to the report. The free
allowance for a private repository is 2,000 machine-minutes a month, roughly 400 scans; `api/index.php` has a brake
(6 scans an hour, 5 pages each, both adjustable) so a busy day cannot burn through it.

Anyone who can open the page can start a scan unless you set an **access code** in `config.php` (a word people
must type). Reports are public files under `runs/`, so do not scan sites whose results must stay private, or set
the code and share it only with the people who need it.

## Set up, once

### 1. Put the scanner on GitHub

The folder is already a Git repository with everything committed. Create the empty repository on GitHub, then push:

1. Go to [github.com/new](https://github.com/new). Repository name `a11y`, **Private**, no README,
   no .gitignore, no license. Create.
2. In Terminal on the Mac:

```bash
cd ~/Documents/A11y && git remote add origin https://github.com/andrea-valerio-ux/a11y.git && git push -u origin main
```

Git asks for a user name and a password. The password is **not** your GitHub password: GitHub wants a token.
The quickest way is [GitHub Desktop](https://desktop.github.com/) (sign in once, then **Add local repository**
→ the A11y folder → **Publish**), or make a classic token with the `repo` scope at
github.com → Settings → Developer settings → Personal access tokens and paste it as the password.

After the push, the **Actions** tab of the repository shows a workflow called **Scan**.

### 2. A token for the website to start scans

github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token:

- Name: `andryta.com scanner`. Expiration: the longest offered (a year); put a reminder to renew it.
- Repository access: **Only select repositories** → `a11y`.
- Permissions → Repository permissions → **Actions: Read and write**. Nothing else.

Copy the token (it starts with `github_pat_`); it is shown once.

### 3. An FTP account for the reports to land in (HostGator)

cPanel → **Files → FTP Accounts** → Add FTP Account:

- Log in: `a11yruns`. Directory: `public_html/technology/a11y/runs`. Quota: 1000 MB or Unlimited.
- Create. Under **Configure FTP Client** note the server name (`ftp.andryta.com`) and the full user name, which
  looks like `a11yruns@andryta.com`.

The account can only write inside `runs/`, so a leaked secret cannot touch the rest of the site.

Then in GitHub: repository → **Settings → Secrets and variables → Actions → New repository secret**, three times:

| Name | Value |
| --- | --- |
| `FTP_HOST` | `ftp.andryta.com` |
| `FTP_USER` | `a11yruns@andryta.com` |
| `FTP_PASSWORD` | the password you chose |

The workflow uses FTP with TLS on port 21. If HostGator's SFTP is enabled on your account, `FTP_PROTOCOL` = `sftp`
and `FTP_PORT` = `2222` work too.

### 4. The website files

cPanel → **Files → File Manager** → `public_html` → `technology` → **+ Folder** `a11y` → open it. First, in
**Settings** (top right), tick **Show Hidden Files**, so `.htaccess` is visible. Then **Upload** these five files
from the `web/` folder of the project:

```
index.html   checklist.js   .htaccess   config.example.php
```

Then **+ Folder** named `api`, open it, and upload `index.php` from the project's `web/api/` folder into it. The
name matters: this hosting account refuses every PHP file that is not called `index.php`, so the API lives in its
own folder under that name.

Still in File Manager, right-click `config.example.php` → **Copy** → name it `config.php`. Right-click
`config.php` → **Edit**: paste the token from step 2 into `github_token`, set an `access_code` if you want one,
save. The FTP account created the `runs` folder already; `api/index.php` creates `data` by itself.

### 5. Try it

- Open `https://andryta.com/technology/a11y/api/index.php?action=check`. It should say `"ok":true` and name the
  workflow. If not, the message tells which of the token, the repository name or the branch is wrong.
- Open `https://andryta.com/technology/a11y/`. The status card says **Ready to scan**.
- Scan `https://andryta.com` with one page at two widths. The status card walks through the steps; the
  **Actions** tab on GitHub shows the same run live. After 3 to 6 minutes the report card appears with the
  counts and the Open and Download buttons, and the run joins the **Previous runs** list.

## Every day

- The page does everything. A scan started in one browser keeps showing its progress after a reload.
- Reports live at `andryta.com/technology/a11y/runs/<site>/<date>-<id>/`. The folder address opens the HTML report;
  the Excel, Word, PDF, CSV and JSON files sit next to it, named `<site>-<date>.<ext>`.
- To scan without the page (or when the page is down): GitHub → Actions → **Scan** → **Run workflow**, type the
  address. The report still lands in `runs/`.
- Disk: an HTML report with its screenshots is 2 to 10 MB; the other five files add about the same. Delete old
  folders in `runs/` from File Manager when space matters.
- The token from step 2 expires; when scans start failing with "GitHub did not accept the scan (401)", make a new
  one and paste it into `config.php`.

## Changing the scanner

Edit the code on the Mac, run `npm test`, then commit and push. The next scan uses the new code. If
`src/checklist.js` changes, run `node scripts/build-web.js` and upload `web/checklist.js` again. If `web/index.html`
or `web/api/index.php` change, upload them again.

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| **The service is not reachable** | `api/index.php` is missing, or a PHP file was uploaded under another name (this hosting answers 403 to any PHP file not named `index.php`) | Step 4: the file must be `api/index.php`. |
| **The service is not configured yet** | `config.php` is missing or still has the example token | Step 4. |
| **GitHub did not accept the scan (401)** | The token is wrong or expired | Step 2, paste the new one. |
| **GitHub did not accept the scan (404)** | Repository name, workflow file or branch in `config.php` is wrong, or the token has no access to the repository | `api/index.php?action=check` names the problem. |
| **GitHub did not accept the scan (403)** | The token has no **Actions: Read and write** permission | Edit the token's permissions. |
| Stuck at **Building and uploading** for more than 10 minutes | The scan finished but the FTP upload failed | Open the run in the Actions tab; the "Upload to the website" step shows the FTP error. Usually a wrong `FTP_USER` (it needs the `@andryta.com` part) or password. |
| **The scan failed** | Chrome could not load the site, or the site blocks automated visits | The Actions log has the details. Try one page first. |
| **The hourly limit is used up** | The brake in `config.php` | Wait, or raise `max_scans_per_hour`. |
| Reports open but no screenshots | The files were edited or served from a cache | Re-run the scan. |

## The paid alternative

A server that runs the whole app live, with its own interactive UI, needs a virtual machine. That route, including
HostGator's VPS plans and the free machines from Oracle and Google, is in `deploy/VPS.md`.
