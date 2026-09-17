'use strict';
// Runs one scan in its own process and reports progress as JSON lines on
// stdout, so a crashed scan cannot take the app with it.
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  const opts = JSON.parse(input);
  const say = o => process.stdout.write(JSON.stringify(o) + '\n');
  require('../util/log').setQuiet(true);
  try {
    await require('../scan').run({ ...opts, onProgress: say });
  } catch (e) {
    say({ type: 'failed', error: String((e && e.message) || e).slice(0, 300) });
    process.exit(1);
  }
});
