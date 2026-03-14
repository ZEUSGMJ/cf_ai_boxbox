const assert = require('node:assert/strict');
const test = require('node:test');

const { handleWorkerFetch } = require('../.test-dist/chat-handler.js');

function createSessionMemoryNamespace() {
  let history = [];

  const stub = {
    async fetch(url, init = {}) {
      const method = init.method || 'GET';
      if (method === 'GET' && url.endsWith('/history')) {
        return Response.json(history);
      }

      if (method === 'POST' && url.endsWith('/history')) {
        const incoming = JSON.parse(init.body || '[]');
        history = [...history, ...incoming].slice(-20);
        return Response.json(history);
      }

      if (method === 'DELETE' && url.endsWith('/history')) {
        history = [];
        return new Response(null, { status: 204 });
      }

      return new Response('Not found', { status: 404 });
    },
  };

  return {
    idFromName(name) {
      return name;
    },
    get() {
      return stub;
    },
  };
}

function createAiStub() {
  const calls = [];

  const AI = {
    calls,
    async run(_model, payload) {
      calls.push(payload);
      const system = payload.messages[0]?.content ?? '';
      const user = payload.messages[payload.messages.length - 1]?.content ?? '';

      if (system.includes('query refiner')) {
        return { response: user };
      }
      if (system.includes('intent classifier')) {
        return { response: 'fallback' };
      }
      return { response: 'Mock assistant response' };
    },
  };

  return AI;
}

test('POST /chat happy path returns response and metadata', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '3',
                raceName: 'Australian Grand Prix',
                date: '2026-12-01',
                time: '05:00:00Z',
                Circuit: {
                  circuitId: 'albert_park',
                  circuitName: 'Albert Park',
                  Location: { locality: 'Melbourne', country: 'Australia' },
                },
              },
            ],
          },
        },
      });
    }
    if (url.includes('/2025/races.json')) {
      return Response.json({ MRData: { RaceTable: { Races: [] } } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };

    const req = new Request('https://local/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'When is the next race?',
        sessionId: 'session_abc',
        timezone: 'America/Los_Angeles',
      }),
    });

    const res = await handleWorkerFetch(req, env);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.match(json.response, /The next race is the Australian Grand Prix/);
    assert.equal(json.meta.intent, 'next_race');
    assert.equal(json.meta.dataStatus, 'ok');
    assert.equal(json.view.type, 'next_races_list');
    assert.equal(json.view.races[0].raceName, 'Australian Grand Prix');
    assert.equal(json.view.races[0].circuitName, 'Albert Park');
    assert.equal(env.AI.calls.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('GET /history returns stored session messages', async () => {
  const env = {
    AI: createAiStub(),
    SESSION_MEMORY: createSessionMemoryNamespace(),
  };

  await handleWorkerFetch(
    new Request('https://local/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'what can you do?',
        sessionId: 'session_abc',
        timezone: 'America/Los_Angeles',
      }),
    }),
    env,
  );

  const res = await handleWorkerFetch(
    new Request('https://local/history?sessionId=session_abc'),
    env,
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(json.history), true);
  assert.equal(json.history.length, 2);
});

test('POST /chat capabilities request bypasses model calls', async () => {
  const env = {
    AI: createAiStub(),
    SESSION_MEMORY: createSessionMemoryNamespace(),
  };

  const req = new Request('https://local/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'what can you do?',
      sessionId: 'session_abc',
      timezone: 'America/Los_Angeles',
    }),
  });

  const res = await handleWorkerFetch(req, env);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.meta.intent, 'capabilities');
  assert.equal(env.AI.calls.length, 0);
});

test('POST /chat rejects blank messages with 400', async () => {
  const env = {
    AI: createAiStub(),
    SESSION_MEMORY: createSessionMemoryNamespace(),
  };

  const req = new Request('https://local/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '   ',
      sessionId: 'session_abc',
      timezone: 'America/Los_Angeles',
    }),
  });

  const res = await handleWorkerFetch(req, env);
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.match(json.error, /empty/i);
});

test('POST /chat handles Jolpica failure and returns dataStatus none', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('network down');
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };

    const req = new Request('https://local/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Who won round 1 in 2026?',
        sessionId: 'session_abc',
        timezone: 'Invalid/Timezone',
      }),
    });

    const res = await handleWorkerFetch(req, env);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.response, 'I could not retrieve results for that race.');
    assert.equal(json.meta.intent, 'race_result');
    assert.equal(json.meta.dataStatus, 'none');
    assert.equal(json.view.type, 'error');
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat sprint winner query fetches sprint results for first sprint round', async () => {
  const realDateNow = Date.now;
  const realFetch = global.fetch;
  const calledUrls = [];
  Date.now = () => new Date('2026-03-24T12:00:00Z').valueOf();
  global.fetch = async (input) => {
    const url = String(input);
    calledUrls.push(url);

    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '1',
                raceName: 'Australian Grand Prix',
                date: '2026-03-10',
                Circuit: {
                  circuitId: 'albert_park',
                  circuitName: 'Albert Park',
                  Location: { locality: 'Melbourne', country: 'Australia' },
                },
              },
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-24',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
                Sprint: { date: '2026-03-23', time: '03:00:00Z' },
              },
            ],
          },
        },
      });
    }

    if (url.includes('/2026/2/sprint.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-24',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
                SprintResults: [
                  {
                    position: '1',
                    points: '8',
                    Driver: { driverId: 'russell', givenName: 'George', familyName: 'Russell' },
                    Constructor: { constructorId: 'mercedes', name: 'Mercedes' },
                  },
                ],
              },
            ],
          },
        },
      });
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };

    const req = new Request('https://local/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Who won the first sprint race of the 2026 season?',
        sessionId: 'session_abc',
        timezone: 'America/Los_Angeles',
      }),
    });

    const res = await handleWorkerFetch(req, env);
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'race_result');
    assert.equal(json.meta.dataStatus, 'ok');
    assert.match(json.response, /George Russell won the 2026 Chinese Grand Prix sprint for Mercedes\./);
    assert.equal(json.view.type, 'race_result');
    assert.equal(json.view.sessionType, 'sprint');
    assert.ok(calledUrls.some((url) => url.includes('/2026/2/sprint.json')));
  } finally {
    Date.now = realDateNow;
    global.fetch = realFetch;
  }
});

test('POST /chat first sprint winner query does not use future sprint rounds', async () => {
  const realFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (input) => {
    const url = String(input);
    calledUrls.push(url);

    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '1',
                raceName: 'Australian Grand Prix',
                date: '2026-03-10',
                Circuit: {
                  circuitId: 'albert_park',
                  circuitName: 'Albert Park',
                  Location: { locality: 'Melbourne', country: 'Australia' },
                },
              },
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-24',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
                Sprint: { date: '2026-03-23', time: '03:00:00Z' },
              },
            ],
          },
        },
      });
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };

    const req = new Request('https://local/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Who won the first sprint race of the 2026 season?',
        sessionId: 'session_abc',
        timezone: 'America/Los_Angeles',
      }),
    });

    const res = await handleWorkerFetch(req, env);
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'race_result');
    assert.equal(json.meta.dataStatus, 'none');
    assert.equal(json.view.type, 'error');
    assert.equal(json.response, 'I could not retrieve results for that race.');
    assert.ok(
      !calledUrls.some((url) => url.includes('/sprint.json')),
      'Should not fetch sprint results for a future sprint round.',
    );
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat next race skips races earlier the same day', async () => {
  const realDateNow = Date.now;
  const realFetch = global.fetch;
  Date.now = () => new Date('2026-03-10T12:00:00Z').valueOf();
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '1',
                raceName: 'Australian Grand Prix',
                date: '2026-03-10',
                time: '05:00:00Z',
                Circuit: {
                  circuitId: 'albert_park',
                  circuitName: 'Albert Park',
                  Location: { locality: 'Melbourne', country: 'Australia' },
                },
              },
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-24',
                time: '07:00:00Z',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
              },
            ],
          },
        },
      });
    }
    if (url.includes('/2025/races.json')) {
      return Response.json({ MRData: { RaceTable: { Races: [] } } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const data = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'When is the next race?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await data.json();
    assert.equal(json.meta.intent, 'next_race');
    assert.equal(json.meta.dataStatus, 'ok');
    assert.match(json.response, /Chinese Grand Prix/);
    assert.doesNotMatch(json.response, /Australian Grand Prix/);
    assert.equal(json.view.type, 'next_races_list');
    assert.equal(json.view.races[0].raceName, 'Chinese Grand Prix');
    assert.equal(env.AI.calls.length, 1);
  } finally {
    Date.now = realDateNow;
    global.fetch = realFetch;
  }
});

test('POST /chat next three races returns a deterministic ordered list', async () => {
  const realDateNow = Date.now;
  const realFetch = global.fetch;
  Date.now = () => new Date('2026-03-14T12:00:00Z').valueOf();
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '1',
                raceName: 'Australian Grand Prix',
                date: '2026-03-08',
                time: '04:00:00Z',
                Circuit: {
                  circuitId: 'albert_park',
                  circuitName: 'Albert Park',
                  Location: { locality: 'Melbourne', country: 'Australia' },
                },
              },
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-15',
                time: '07:00:00Z',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
              },
              {
                season: '2026',
                round: '3',
                raceName: 'Japanese Grand Prix',
                date: '2026-03-29',
                time: '06:00:00Z',
                Circuit: {
                  circuitId: 'suzuka',
                  circuitName: 'Suzuka Circuit',
                  Location: { locality: 'Suzuka', country: 'Japan' },
                },
              },
              {
                season: '2026',
                round: '4',
                raceName: 'Bahrain Grand Prix',
                date: '2026-04-12',
                time: '15:00:00Z',
                Circuit: {
                  circuitId: 'bahrain',
                  circuitName: 'Bahrain International Circuit',
                  Location: { locality: 'Sakhir', country: 'Bahrain' },
                },
              },
              {
                season: '2026',
                round: '5',
                raceName: 'Saudi Arabian Grand Prix',
                date: '2026-04-19',
                time: '17:00:00Z',
                Circuit: {
                  circuitId: 'jeddah',
                  circuitName: 'Jeddah Corniche Circuit',
                  Location: { locality: 'Jeddah', country: 'Saudi Arabia' },
                },
              },
            ],
          },
        },
      });
    }
    if (url.includes('/2025/races.json')) {
      return Response.json({ MRData: { RaceTable: { Races: [] } } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What are the next 3 races?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'next_race');
    assert.equal(json.meta.dataStatus, 'ok');
    assert.match(
      json.response,
      /The next 3 races are Chinese Grand Prix, Japanese Grand Prix, and Bahrain Grand Prix\./,
    );
    assert.doesNotMatch(json.response, /Australian Grand Prix/);
    assert.doesNotMatch(json.response, /Saudi Arabian Grand Prix/);
    assert.equal(json.view.type, 'next_races_list');
    assert.equal(json.view.races.length, 3);
    assert.equal(json.view.races[0].raceName, 'Chinese Grand Prix');
    assert.equal(json.view.races[2].raceName, 'Bahrain Grand Prix');
    assert.equal(env.AI.calls.length, 1);
  } finally {
    Date.now = realDateNow;
    global.fetch = realFetch;
  }
});

test('POST /chat next race count follows the original user request, not the refined query wording', async () => {
  const realDateNow = Date.now;
  const realFetch = global.fetch;
  Date.now = () => new Date('2026-03-14T12:00:00Z').valueOf();
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/2026/races.json')) {
      return Response.json({
        MRData: {
          RaceTable: {
            Races: [
              {
                season: '2026',
                round: '2',
                raceName: 'Chinese Grand Prix',
                date: '2026-03-15',
                time: '07:00:00Z',
                Circuit: {
                  circuitId: 'shanghai',
                  circuitName: 'Shanghai International Circuit',
                  Location: { locality: 'Shanghai', country: 'China' },
                },
              },
              {
                season: '2026',
                round: '3',
                raceName: 'Japanese Grand Prix',
                date: '2026-03-29',
                time: '06:00:00Z',
                Circuit: {
                  circuitId: 'suzuka',
                  circuitName: 'Suzuka Circuit',
                  Location: { locality: 'Suzuka', country: 'Japan' },
                },
              },
              {
                season: '2026',
                round: '4',
                raceName: 'Bahrain Grand Prix',
                date: '2026-04-12',
                time: '15:00:00Z',
                Circuit: {
                  circuitId: 'bahrain',
                  circuitName: 'Bahrain International Circuit',
                  Location: { locality: 'Sakhir', country: 'Bahrain' },
                },
              },
              {
                season: '2026',
                round: '5',
                raceName: 'Saudi Arabian Grand Prix',
                date: '2026-04-19',
                time: '17:00:00Z',
                Circuit: {
                  circuitId: 'jeddah',
                  circuitName: 'Jeddah Corniche Circuit',
                  Location: { locality: 'Jeddah', country: 'Saudi Arabia' },
                },
              },
            ],
          },
        },
      });
    }
    if (url.includes('/2025/races.json')) {
      return Response.json({ MRData: { RaceTable: { Races: [] } } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const env = {
    AI: {
      calls: [],
      async run(_model, payload) {
        this.calls.push(payload);
        const system = payload.messages[0]?.content ?? '';
        const user = payload.messages[payload.messages.length - 1]?.content ?? '';
        if (system.includes('query refiner')) {
          return {
            response:
              'What are the dates, locations, and circuits for the next Formula 1 races after Australia?',
          };
        }
        if (system.includes('intent classifier')) {
          return { response: 'next_race' };
        }
        return { response: user };
      },
    },
    SESSION_MEMORY: createSessionMemoryNamespace(),
  };

  try {
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What are the next 3 upcoming races?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'next_race');
    assert.match(
      json.response,
      /The next 3 races are Chinese Grand Prix, Japanese Grand Prix, and Bahrain Grand Prix\./,
    );
    assert.equal(json.view.type, 'next_races_list');
    assert.equal(json.view.races.length, 3);
  } finally {
    Date.now = realDateNow;
    global.fetch = realFetch;
  }
});

test('POST /chat combined standings returns deterministic driver and constructor tables', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '1',
                    points: '25',
                    wins: '1',
                    Driver: {
                      driverId: 'russell',
                      givenName: 'George',
                      familyName: 'Russell',
                    },
                    Constructors: [{ constructorId: 'mercedes', name: 'Mercedes' }],
                  },
                  {
                    position: '2',
                    points: '18',
                    wins: '0',
                    Driver: {
                      driverId: 'leclerc',
                      givenName: 'Charles',
                      familyName: 'Leclerc',
                    },
                    Constructors: [{ constructorId: 'ferrari', name: 'Ferrari' }],
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (url.includes('/current/constructorStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                ConstructorStandings: [
                  {
                    position: '1',
                    points: '43',
                    wins: '1',
                    Constructor: { constructorId: 'mercedes', name: 'Mercedes' },
                  },
                  {
                    position: '2',
                    points: '27',
                    wins: '0',
                    Constructor: { constructorId: 'ferrari', name: 'Ferrari' },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Show all standings',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'both_standings');
    assert.equal(json.meta.dataStatus, 'ok');
    assert.equal(
      json.response,
      'Here are the current 2026 Formula 1 driver and constructor standings.',
    );
    assert.equal(json.view.type, 'standings_table');
    assert.equal(json.view.tables[0].rows[0].driverName, 'George Russell');
    assert.equal(json.view.tables[0].rows[0].teamName, 'Mercedes');
    assert.equal(json.view.tables[1].rows[0].constructorName, 'Mercedes');
    assert.deepEqual(json.view.unavailableTables, []);
    assert.equal(env.AI.calls.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat combined standings reports partial data without broken markdown tables', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [],
              },
            ],
          },
        },
      });
    }
    if (url.includes('/current/constructorStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                ConstructorStandings: [
                  {
                    position: '1',
                    points: '43',
                    wins: '1',
                    Constructor: { constructorId: 'mercedes', name: 'Mercedes' },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Show all standings',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'both_standings');
    assert.equal(json.meta.dataStatus, 'partial');
    assert.equal(
      json.response,
      'I could only retrieve the current 2026 constructor standings.',
    );
    assert.equal(json.view.type, 'standings_table');
    assert.deepEqual(json.view.unavailableTables, ['drivers']);
    assert.equal(json.view.tables[0].rows[0].constructorName, 'Mercedes');
    assert.equal(env.AI.calls.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat driver stats returns a focused summary for a matched driver', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '6',
                    points: '8',
                    wins: '0',
                    Driver: {
                      driverId: 'verstappen',
                      givenName: 'Max',
                      familyName: 'Verstappen',
                      code: 'VER',
                    },
                    Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }],
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (url.includes('/current/constructorStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                ConstructorStandings: [
                  {
                    position: '2',
                    points: '27',
                    wins: '0',
                    Constructor: { constructorId: 'ferrari', name: 'Ferrari' },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How is Max currently performing?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'driver_stats');
    assert.equal(
      json.response,
      'Max Verstappen is currently 6th in the 2026 driver standings with 8 points and 0 wins for Red Bull.',
    );
    assert.equal(json.view.type, 'driver_summary');
    assert.equal(json.view.driver.name, 'Max Verstappen');
    assert.equal(json.view.driver.team, 'Red Bull');
    assert.equal(json.view.driver.position, '6');
    assert.equal(json.view.driver.points, 8);
    assert.equal(env.AI.calls.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat driver stats returns a constructor summary for team performance queries', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '2',
                    points: '18',
                    wins: '0',
                    Driver: {
                      driverId: 'leclerc',
                      givenName: 'Charles',
                      familyName: 'Leclerc',
                    },
                    Constructors: [{ constructorId: 'ferrari', name: 'Ferrari' }],
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (url.includes('/current/constructorStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                ConstructorStandings: [
                  {
                    position: '2',
                    points: '27',
                    wins: '0',
                    Constructor: { constructorId: 'ferrari', name: 'Ferrari' },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How has Ferrari been doing?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'driver_stats');
    assert.equal(
      json.response,
      'Ferrari is currently 2nd in the 2026 constructor standings with 27 points and 0 wins.',
    );
    assert.equal(json.view.type, 'constructor_summary');
    assert.equal(json.view.constructor.name, 'Ferrari');
    assert.equal(json.view.constructor.position, '2');
    assert.equal(json.view.constructor.points, 27);
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat driver stats returns clarification instead of a standings dump for ambiguous queries', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '1',
                    points: '25',
                    wins: '1',
                    Driver: {
                      driverId: 'russell',
                      givenName: 'George',
                      familyName: 'Russell',
                    },
                    Constructors: [{ constructorId: 'mercedes', name: 'Mercedes' }],
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (url.includes('/current/constructorStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                ConstructorStandings: [
                  {
                    position: '1',
                    points: '43',
                    wins: '1',
                    Constructor: { constructorId: 'mercedes', name: 'Mercedes' },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How is the rookie doing?',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'driver_stats');
    assert.equal(json.view.type, 'clarification');
    assert.equal(
      json.response,
      'I could not confidently identify the driver or constructor from your question. Please use the full name.',
    );
    assert.doesNotMatch(json.response, /standings/i);
  } finally {
    global.fetch = realFetch;
  }
});

test('POST /chat driver standings does not render undefined positions', async () => {
  const realFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/current/driverStandings.json')) {
      return Response.json({
        MRData: {
          StandingsTable: {
            StandingsLists: [
              {
                DriverStandings: [
                  {
                    position: '16',
                    positionText: '16',
                    points: '0',
                    wins: '0',
                    Driver: {
                      driverId: 'perez',
                      givenName: 'Sergio',
                      familyName: 'Perez',
                    },
                    Constructors: [{ constructorId: 'cadillac', name: 'Cadillac F1 Team' }],
                  },
                  {
                    positionText: '17',
                    points: '0',
                    wins: '0',
                    Driver: {
                      driverId: 'stroll',
                      givenName: 'Lance',
                      familyName: 'Stroll',
                    },
                    Constructors: [{ constructorId: 'aston_martin', name: 'Aston Martin' }],
                  },
                ],
              },
            ],
          },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const env = {
      AI: createAiStub(),
      SESSION_MEMORY: createSessionMemoryNamespace(),
    };
    const res = await handleWorkerFetch(
      new Request('https://local/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Show driver standings',
          sessionId: 'session_abc',
          timezone: 'America/Los_Angeles',
        }),
      }),
      env,
    );
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.meta.intent, 'driver_standings');
    assert.equal(json.view.type, 'standings_table');
    assert.equal(json.view.tables[0].rows[1].position, '17');
    assert.equal(json.view.tables[0].rows[1].driverName, 'Lance Stroll');
    assert.equal(json.view.tables[0].rows[1].teamName, 'Aston Martin');
    assert.doesNotMatch(JSON.stringify(json), /undefined/);
  } finally {
    global.fetch = realFetch;
  }
});
