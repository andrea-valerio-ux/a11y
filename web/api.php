<?php
// The small server side of the scanner on shared hosting. It does three things:
//   action=scan    start a scan: tells GitHub to run the workflow with the address
//   action=status  where a scan is: queued, running, done (with its folder), failed
//   action=runs    list the finished runs found in runs/
//   action=ping    is this file configured?
// The GitHub token lives in config.php next to this file and never reaches the
// browser. Finished reports arrive in runs/ by FTP from the workflow.
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const RUNS_DIR = __DIR__ . '/runs';
const DATA_DIR = __DIR__ . '/data';
const GITHUB_API = 'https://api.github.com';

function out(int $code, array $body): void {
  http_response_code($code);
  echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

$cfg = @include __DIR__ . '/config.php';
if (!is_array($cfg)) out(500, ['error' => 'config.php is missing. Copy config.example.php to config.php and fill it in.']);
$cfg += ['workflow_file' => 'scan.yml', 'branch' => 'main', 'access_code' => '', 'max_scans_per_hour' => 6, 'max_pages' => 5];

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ---------- helpers ---------- */

function github(array $cfg, string $method, string $path, ?array $body = null): array {
  $ch = curl_init(GITHUB_API . $path);
  $headers = [
    'Accept: application/vnd.github+json',
    'Authorization: Bearer ' . $cfg['github_token'],
    'X-GitHub-Api-Version: 2022-11-28',
    'User-Agent: a11y-checklist-scanner (andryta.com)',
  ];
  if ($body !== null) { $headers[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body)); }
  curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
  $raw = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  if ($raw === false) return ['status' => 0, 'error' => $err ?: 'no answer from GitHub', 'json' => null];
  return ['status' => $status, 'json' => json_decode((string) $raw, true), 'error' => null];
}

function dataFile(string $name): string {
  if (!is_dir(DATA_DIR)) { @mkdir(DATA_DIR, 0755, true); @file_put_contents(DATA_DIR . '/.htaccess', "Require all denied\n"); }
  return DATA_DIR . '/' . $name;
}

// Recent requests, for the hourly brake and for "queued" answers before GitHub lists the run.
function loadRequests(): array {
  $f = dataFile('requests.json');
  $list = is_file($f) ? json_decode((string) file_get_contents($f), true) : [];
  if (!is_array($list)) $list = [];
  $cut = time() - 86400;
  return array_values(array_filter($list, fn($r) => ($r['at'] ?? 0) >= $cut));
}
function saveRequests(array $list): void { file_put_contents(dataFile('requests.json'), json_encode($list), LOCK_EX); }

// A finished run is a folder runs/<site>/<stamp>-<id>/meta.json.
function findRun(string $id): ?array {
  foreach (glob(RUNS_DIR . '/*/*-' . $id . '/meta.json') ?: [] as $f) {
    $m = json_decode((string) file_get_contents($f), true);
    if (is_array($m)) return decorate($m, $f);
  }
  return null;
}
function decorate(array $m, string $metaFile): array {
  $folder = 'runs/' . basename(dirname($metaFile, 2)) . '/' . basename(dirname($metaFile));
  $m['folder'] = $folder;
  $m['files'] = array_map(fn($x) => $x + ['href' => $folder . '/' . $x['name']], $m['files'] ?? []);
  return $m;
}
function listRuns(): array {
  $out = [];
  foreach (glob(RUNS_DIR . '/*/*/meta.json') ?: [] as $f) {
    $m = json_decode((string) file_get_contents($f), true);
    if (is_array($m)) $out[] = decorate($m, $f);
  }
  usort($out, fn($a, $b) => strcmp($b['finishedAt'] ?? '', $a['finishedAt'] ?? ''));
  return $out;
}
function safeId(string $s): string { return preg_replace('/[^a-z0-9]/i', '', $s) ?: ''; }

/* ---------- actions ---------- */

if ($action === 'ping') {
  $configured = !empty($cfg['github_token']) && strpos((string) $cfg['github_token'], '...') === false;
  out(200, ['ok' => true, 'configured' => $configured, 'needsCode' => $cfg['access_code'] !== '', 'maxPages' => (int) $cfg['max_pages'], 'maxScansPerHour' => (int) $cfg['max_scans_per_hour'], 'runs' => count(listRuns())]);
}

if ($action === 'check') {
  // Does the token reach the repository and see the workflow?
  $r = github($cfg, 'GET', "/repos/{$cfg['github_owner']}/{$cfg['github_repo']}/actions/workflows/{$cfg['workflow_file']}");
  if ($r['status'] === 200) out(200, ['ok' => true, 'workflow' => $r['json']['name'] ?? '', 'state' => $r['json']['state'] ?? '']);
  out(502, ['ok' => false, 'error' => 'GitHub answered ' . $r['status'] . ': ' . ($r['json']['message'] ?? $r['error'] ?? 'unknown')]);
}

if ($action === 'runs') {
  out(200, ['runs' => listRuns()]);
}

if ($action === 'status') {
  $id = safeId((string) ($_GET['id'] ?? ''));
  if ($id === '') out(400, ['error' => 'missing id']);
  $done = findRun($id);
  if ($done) out(200, ['state' => 'done', 'run' => $done]);

  $req = null;
  foreach (loadRequests() as $r) if (($r['id'] ?? '') === $id) { $req = $r; break; }

  $owner = $cfg['github_owner']; $repo = $cfg['github_repo'];
  $r = github($cfg, 'GET', "/repos/$owner/$repo/actions/workflows/{$cfg['workflow_file']}/runs?event=workflow_dispatch&per_page=40");
  if ($r['status'] === 200) {
    foreach ($r['json']['workflow_runs'] ?? [] as $run) {
      $title = (string) ($run['display_title'] ?? $run['name'] ?? '');
      if (substr($title, -strlen($id)) !== $id && strpos($title, '· ' . $id) === false) continue;
      $status = $run['status'];              // queued | in_progress | completed
      if ($status === 'completed') {
        $ok = ($run['conclusion'] ?? '') === 'success';
        // Success but no meta.json yet: the FTP upload is still landing, or never configured.
        out(200, ['state' => $ok ? 'uploading' : 'failed', 'conclusion' => $run['conclusion'], 'runUrl' => $run['html_url'], 'startedAt' => $run['run_started_at'] ?? null]);
      }
      out(200, ['state' => $status === 'in_progress' ? 'running' : 'queued', 'runUrl' => $run['html_url'], 'startedAt' => $run['run_started_at'] ?? null]);
    }
  }
  if ($req) {
    $age = time() - (int) $req['at'];
    if ($age > 45 * 60) out(200, ['state' => 'lost', 'error' => 'The scan was requested ' . intdiv($age, 60) . ' minutes ago and never appeared on GitHub.']);
    out(200, ['state' => 'queued', 'requestedAt' => $req['at']]);
  }
  out(404, ['state' => 'unknown', 'error' => 'No scan with that id.']);
}

if ($action === 'scan') {
  if ($method !== 'POST') out(405, ['error' => 'POST only']);
  $in = json_decode((string) file_get_contents('php://input'), true);
  if (!is_array($in)) out(400, ['error' => 'bad body']);
  if ($cfg['access_code'] !== '' && !hash_equals((string) $cfg['access_code'], (string) ($in['code'] ?? ''))) out(403, ['error' => 'The access code is not right.']);
  if (empty($in['authorized'])) out(400, ['error' => 'A scan sends real traffic. Confirm you are authorized to scan this site.']);

  $url = trim((string) ($in['url'] ?? ''));
  if ($url !== '' && !preg_match('~^https?://~i', $url)) $url = 'https://' . $url;
  $parts = parse_url($url);
  if (!filter_var($url, FILTER_VALIDATE_URL) || empty($parts['host']) || strpos($parts['host'], '.') === false) out(400, ['error' => 'That does not look like a web address.']);
  if (preg_match('/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/', $parts['host'])) out(400, ['error' => 'That address is not reachable from the scanner.']);

  $pages = max(1, min((int) $cfg['max_pages'], (int) ($in['pages'] ?? 1)));
  $widths = preg_replace('/[^0-9,]/', '', (string) ($in['widths'] ?? '1440,390')) ?: '1440,390';
  $widths = implode(',', array_slice(array_values(array_unique(array_filter(array_map('intval', explode(',', $widths)), fn($w) => $w >= 320 && $w <= 2560))), 0, 4)) ?: '1440,390';
  $level = strtoupper((string) ($in['level'] ?? 'AA')) === 'AAA' ? 'AAA' : 'AA';

  $requests = loadRequests();
  $lastHour = array_filter($requests, fn($r) => ($r['at'] ?? 0) >= time() - 3600);
  if (count($lastHour) >= (int) $cfg['max_scans_per_hour']) out(429, ['error' => 'The hourly limit of ' . (int) $cfg['max_scans_per_hour'] . ' scans is used up. Try again in a while.']);

  $id = substr(bin2hex(random_bytes(6)), 0, 12);
  $owner = $cfg['github_owner']; $repo = $cfg['github_repo'];
  $r = github($cfg, 'POST', "/repos/$owner/$repo/actions/workflows/{$cfg['workflow_file']}/dispatches", [
    'ref' => $cfg['branch'],
    'inputs' => ['url' => $url, 'pages' => (string) $pages, 'widths' => $widths, 'level' => $level, 'request_id' => $id],
  ]);
  if ($r['status'] !== 204) out(502, ['error' => 'GitHub did not accept the scan (' . $r['status'] . '): ' . ($r['json']['message'] ?? $r['error'] ?? 'unknown')]);

  $requests[] = ['id' => $id, 'url' => $url, 'at' => time()];
  saveRequests($requests);
  out(200, ['id' => $id, 'url' => $url, 'pages' => $pages, 'widths' => $widths, 'level' => $level]);
}

out(404, ['error' => 'unknown action']);
