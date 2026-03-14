const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyCannedIntent,
  keywordClassify,
} = require('../.test-dist/intent.js');

test('classifyCannedIntent routes capabilities without model calls', () => {
  assert.equal(classifyCannedIntent('what can you do?'), 'capabilities');
  assert.equal(classifyCannedIntent('your capabilities'), 'capabilities');
});

test('classifyCannedIntent routes live telemetry requests', () => {
  assert.equal(classifyCannedIntent('show live telemetry feed'), 'live_telemetry');
  assert.equal(classifyCannedIntent('live timing data right now'), 'live_telemetry');
});

test('keywordClassify routes ambiguous standings to both_standings', () => {
  assert.equal(keywordClassify('show me full standings'), 'both_standings');
  assert.equal(keywordClassify('points table today'), 'both_standings');
});

test('keywordClassify prioritizes winner queries over generic sprint schedule patterns', () => {
  assert.equal(keywordClassify('Who won the first sprint race of 2026?'), 'race_result');
});

test('keywordClassify routes driver performance questions to driver_stats before standings', () => {
  assert.equal(
    keywordClassify(
      'How has Max Verstappen performed in the 2026 season so far, including his current position in the driver standings?',
    ),
    'driver_stats',
  );
});

test('keywordClassify routes natural doing phrasing to driver_stats', () => {
  assert.equal(keywordClassify('How has Ferrari been doing?'), 'driver_stats');
  assert.equal(keywordClassify('How is Hamilton doing?'), 'driver_stats');
});
