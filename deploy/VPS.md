# Running the scanner online

Two pieces, in two places:

| Piece | What it is | Where it goes |
| --- | --- | --- |
| **Backend** | The scanner itself: Node.js plus a real Google Chrome, listening on `127.0.0.1:4173`, with Nginx in front for HTTPS. The code is deployed exactly as it is. | A Linux virtual machine. A free one from Oracle Cloud or Google Cloud, or a paid VPS. |
| **Frontend page** | `web/index.html`: a page on andryta.com that says whether the scanner is online, wakes it if it is asleep, lists what it checks, and opens it. | HostGator, at `andryta.com/technology/a11y/`, uploaded like the Python course. |

HostGator's shared plan cannot run the backend (no Chrome, no long-running processes), which is why the two pieces
live apart. The scanner has no sign-in of its own: **anyone who can open the backend address can start scans and read
every report**. Step 7 adds a password in Nginx if you want one.

## Free servers that can run it (checked September 2026)

The backend needs about 1 GB of memory while Chrome scans a page, a disk for screenshots, and the ability to install
Chrome and keep a process running. That rules out most "free tier" platforms:

| Host | Free offer | Runs the scanner? |
| --- | --- | --- |
| **Oracle Cloud Always Free** | One Ampere ARM VM with 2 OCPUs and 12 GB of memory, 200 GB of disk, no time limit. (Was 4 OCPUs and 24 GB until June 15, 2026.) A credit card is required for identity checks; nothing is charged on Always Free shapes. | **Yes, best fit.** Two catches: sign-ups are sometimes refused, and the free ARM shape is often "out of capacity" in busy regions, so creating the machine can take several tries over a few days. Oracle can also stop an Always Free machine that sits idle for a week; it restarts from the console. |
| **Google Cloud Always Free** | One e2-micro VM (2 shared vCPUs, 1 GB of memory) with 30 GB of disk, free every month, only in us-west1, us-central1 or us-east1. Card required. | **Yes, tightly.** 1 GB is little for Chrome; the install script adds 2 GB of swap. Fine for one or two pages at a time, slow for more. |
| AWS Free Tier | Since July 2025 new accounts get up to $200 in credits for six months, then pay. | Only for six months. |
| Render free plan | 512 MB of memory, 0.1 CPU, sleeps after 15 minutes. | No: too little memory for Chrome, and it expects a service that listens on all addresses. |
| Koyeb free instance | 512 MB, 0.1 vCPU, no persistent disk, sleeps after an hour. | No, same reasons. |
| Railway | $5 trial for 30 days, then $1 of usage a month, 0.5 GB. | No. |
| Fly.io | Free tier ended in October 2024; $5 a month minimum. | No. |
| Hugging Face Spaces | 2 vCPUs and 16 GB free, Docker supported, but no persistent disk (runs vanish on restart), sleeps after 48 hours, and Docker Spaces may need a paid plan. | No: reports would disappear. |
| HostGator shared hosting | Static files and PHP. | No. |

**Recommendation:** Oracle Cloud Always Free. If the sign-up is refused or the ARM shape never becomes available,
use Google Cloud's e2-micro, or a paid VPS at $3 to $6 a month, which needs no tricks at all. The install scripts
handle all of them.

### HostGator's own VPS (Snappy 1000 - NVMe 2, $2.64 a month for the first term, then $4.95)

This works, and it is the simplest paid option because the DNS, the billing and the server sit in the same account.
1 vCPU and 2 GB of DDR5 memory are enough: the install script adds 2 GB of swap and Chrome scans a page at two
widths in about a minute. 50 GB of NVMe holds a few thousand runs. When ordering:

- Choose **without cPanel**. cPanel's web server would take ports 80 and 443, which Nginx needs.
- The plans come with **AlmaLinux 9**. Use `deploy/install-almalinux.sh` instead of the Ubuntu script; everything
  else in this guide is the same. If the order form offers Ubuntu 24.04, either works.
- Log in as `root` with the password from the welcome email. The public IP is the "dedicated IP" of the plan.

## Steps

### 1. Create the free virtual machine

**Oracle Cloud**

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Choose a home region close to you (for
   Costa Rica, a US region). Enter the card when asked; it is a verification, not a charge.
2. In the console: **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 24.04** (the aarch64 build is selected once the shape is ARM).
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPUs, 12 GB**. Staying at or under these numbers keeps it free.
   - Networking: create a new virtual cloud network with a **public IPv4 address**.
   - SSH keys: **Generate a key pair** and download the private key; keep it in `~/.ssh/oracle.key` and run
     `chmod 600 ~/.ssh/oracle.key`.
   - Create. If the console says **Out of host capacity**, wait an hour or a day and try again, or try another
     availability domain in the same region.
3. Open the ports. Instance page → **Subnet** → **Security list** → **Add ingress rules**: source `0.0.0.0/0`,
   protocol TCP, destination port `80`; then the same for `443`. (The install script opens the same ports in the
   machine's own firewall.)
4. Note the **public IP address** shown on the instance page. The login user is `ubuntu`.

**Google Cloud (alternative)**

1. Sign up at [cloud.google.com/free](https://cloud.google.com/free) and create a project.
2. **Compute Engine → Create instance**: region **us-central1**, machine type **e2-micro**, boot disk
   **Ubuntu 24.04 LTS x86/64, 30 GB standard persistent disk**, and tick **Allow HTTP traffic** and
   **Allow HTTPS traffic**.
3. Use the browser SSH button or add your own key. Note the **external IP** and reserve it as static
   (**VPC network → IP addresses → Reserve**) so it does not change.

### 2. Point a subdomain at it (HostGator cPanel)

andryta.com stays where it is. Only a new name goes to the machine.

1. cPanel → **Domains → Zone Editor** → **andryta.com → Manage**.
2. **Add Record**: type **A**, name `scan`, TTL 14400, record = the machine's public IP address. Save.
3. From your Mac, wait until this prints that address:

```bash
dig +short scan.andryta.com
```

### 3. Upload the scanner folder

From your Mac, leaving out the parts the server rebuilds itself. Replace `SERVER-IP`; on Google Cloud the user
is the one you signed in with instead of `ubuntu`, and the key is the one you added.

```bash
rsync -av -e "ssh -i ~/.ssh/oracle.key" --exclude node_modules --exclude dist --exclude .cache --exclude .claude ~/Documents/A11y/ ubuntu@SERVER-IP:~/a11y-checklist-scanner/
```

### 4. Install everything on the machine

```bash
ssh -i ~/.ssh/oracle.key ubuntu@SERVER-IP
```

```bash
cd ~/a11y-checklist-scanner && sudo bash deploy/install-ubuntu.sh scan.andryta.com you@example.com
```

On an AlmaLinux machine (HostGator VPS), run `deploy/install-almalinux.sh` with the same two arguments instead.

The script installs Node.js 22 and a browser (Google Chrome on x86; on ARM, the Chromium build published by the
Playwright project, because Google does not ship Chrome for ARM Linux), adds swap on small machines, copies the
folder to `/opt/a11y-checklist-scanner`, installs the dependencies, creates a service that starts at boot, opens
ports 80 and 443 in the machine's firewall, configures Nginx for `scan.andryta.com`, requests a certificate from
Let's Encrypt with the email address you give, and prints the link to open. Run it again after uploading a new
version; it replaces the files and restarts the service. Ten minutes on Oracle, longer on the 1 GB Google machine.

### 5. Try it

Open `https://scan.andryta.com/`. The app appears and **Try the practice page** works: the practice page is served
by the scanner and scanned on the same machine.

### 6. Put the frontend page on HostGator

1. Open `web/index.html` in a text editor. Near the top of the script there is one line to check:

   ```js
   const SCANNER_URL = 'https://scan.andryta.com';
   ```

   Leave it if you used that name; otherwise put the address of your machine.
2. cPanel → **Files → File Manager** → `public_html` → `technology` → **+ Folder** named `a11y` → open it →
   **Upload** → choose `web/index.html`.
3. Visit `https://andryta.com/technology/a11y/`. The page shows **Scanner is online** with an **Open the scanner**
   button. If the machine is asleep or restarting, the page keeps checking and says so.

### 7. Optional: a password in front

```bash
sudo apt-get install -y apache2-utils && sudo htpasswd -c /etc/nginx/.a11y-htpasswd andryta
```

Edit `/etc/nginx/sites-available/scan.andryta.com`, remove the `#` from the two `auth_basic` lines, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The browser asks for the user name and password once per session. Nothing in the scanner changes.

## Day to day

Useful commands on the machine:

```bash
sudo systemctl status a11y-scanner
```

```bash
sudo journalctl -u a11y-scanner -n 100 -f
```

```bash
sudo systemctl restart a11y-scanner
```

Runs are kept in `/var/lib/a11y-scanner/runs/<site>/<date>/`, the same layout as `~/a11y-checklist-runs` on a Mac.
**Clear all** in the app frees the disk. On Oracle, if the machine was stopped for being idle, start it again from
**Compute → Instances**; the service comes back by itself.

## Files

| File | What it is |
| --- | --- |
| `web/index.html` | The page for HostGator: status, wake-up, what is checked, the Open button. Everything else stays on the machine. |
| `deploy/install-ubuntu.sh` | The one-command setup above, for Ubuntu 22.04 or 24.04 (Oracle, Google, most VPS providers). |
| `deploy/install-almalinux.sh` | The same setup for AlmaLinux 9 or Rocky Linux 9 (HostGator's VPS plans). |
| `deploy/a11y-scanner.service` | The systemd unit: runs `node bin/a11y.js ui --no-open --port 4173` as the `a11y` user, restarts on failure. The script adds a drop-in with the browser path it found. |
| `deploy/nginx-scan.conf` | The Nginx site: passes traffic to 127.0.0.1:4173, rewrites the Origin header to the loopback address the app insists on, keeps the progress stream unbuffered, holds the optional password block. |
| `deploy/show-link.sh` | Prints the current link from the service log with the public host name. |

## Sources for the free-tier table

- Oracle: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
  [InfoQ on the June 2026 cut](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/),
  [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)
- Google Cloud: [Compute Engine free tier](https://cloud.google.com/free/docs/compute-getting-started)
- AWS: [Free Tier in 2026](https://dev.to/aiunplugged/aws-free-tier-in-2026-what-actually-stays-free-5bcp)
- Render: [Platforms with a real free tier in 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- Koyeb: [Instances](https://www.koyeb.com/docs/reference/instances), [Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing)
- Railway: [Free trial](https://docs.railway.com/pricing/free-trial), [Plans](https://docs.railway.com/pricing/plans)
- Fly.io: [Free tier is dead?](https://community.fly.io/t/free-tier-is-dead/20651)
- Hugging Face: [Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview), [Spaces storage](https://huggingface.co/docs/hub/spaces-storage)
- Puppeteer on ARM: [issue 7740](https://github.com/puppeteer/puppeteer/issues/7740)
