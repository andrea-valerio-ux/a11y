<?php
// Copy this file to config.php (same folder) and fill it in. config.php is
// never uploaded to GitHub and the .htaccess keeps browsers away from it.
return [
  // The GitHub account and the private repository that holds the scanner.
  'github_owner' => 'andrea-valerio-ux',
  'github_repo'  => 'a11y',

  // A fine-grained personal access token for that one repository with
  // "Actions: Read and write" (and nothing else). Made at
  // github.com → Settings → Developer settings → Fine-grained tokens.
  'github_token' => 'github_pat_...',

  // Leave these unless you renamed the workflow file or the branch.
  'workflow_file' => 'scan.yml',
  'branch'        => 'main',

  // Optional: a word people must type to start a scan. Empty means anyone
  // who opens the page can start one (each scan spends GitHub minutes).
  'access_code' => '',

  // Brakes on the free GitHub minutes: at most this many scans per hour,
  // and at most this many pages per scan.
  'max_scans_per_hour' => 6,
  'max_pages'          => 5,
];
