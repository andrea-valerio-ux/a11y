'use strict';
// Terminal output. The UI runs scans in a child process and reads JSON
// lines from stdout, so everything here goes to stderr and can be silenced.
let quiet = false;
const write = s => { if (!quiet) process.stderr.write(s + '\n'); };

module.exports = {
  setQuiet(v) { quiet = !!v; },
  step: s => write('  ' + s),
  warn: s => write('  ! ' + s),
  fail: s => write('  x ' + s),
  out: s => process.stdout.write(s + '\n')
};
