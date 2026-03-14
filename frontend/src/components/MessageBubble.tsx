import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Message, ResponseView } from '../types';
import RefinedQueryLabel from './RefinedQueryLabel';

interface Props {
  message: Message;
}

function renderAssistantHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { gfm: true, breaks: true }) as string;
  const sanitized = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  const doc = new DOMParser().parseFromString(sanitized, 'text/html');

  for (const anchor of Array.from(doc.querySelectorAll('a'))) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer nofollow');
  }

  return doc.body.innerHTML;
}

function formatValue(value: number | null): string {
  return value === null ? '-' : `${value}`;
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function StructuredView({ view }: { view: ResponseView }) {
  switch (view.type) {
    case 'driver_summary':
      return (
        <div className="rounded-[24px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="m-0 text-sm font-semibold text-white">{view.title}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Driver</p>
              <p className="mt-1 text-sm text-slate-100">{view.driver.name}</p>
            </div>
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Team</p>
              <p className="mt-1 text-sm text-slate-100">{view.driver.team}</p>
            </div>
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Position</p>
              <p className="mt-1 text-sm text-slate-100">{view.driver.position}</p>
            </div>
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Points / Wins</p>
              <p className="mt-1 text-sm text-slate-100">
                {formatValue(view.driver.points)} / {formatValue(view.driver.wins)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.followups.map((followup) => (
              <span
                key={followup}
                className="rounded-full border border-[color:var(--border)] bg-black/15 px-3 py-1 text-[0.74rem] text-slate-300"
              >
                {followup}
              </span>
            ))}
          </div>
        </div>
      );

    case 'constructor_summary':
      return (
        <div className="rounded-[24px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="m-0 text-sm font-semibold text-white">{view.title}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Team</p>
              <p className="mt-1 text-sm text-slate-100">{view.constructor.name}</p>
            </div>
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Position</p>
              <p className="mt-1 text-sm text-slate-100">{view.constructor.position}</p>
            </div>
            <div className="rounded-2xl bg-black/18 px-3 py-3">
              <p className="m-0 text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Points / Wins</p>
              <p className="mt-1 text-sm text-slate-100">
                {formatValue(view.constructor.points)} / {formatValue(view.constructor.wins)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.followups.map((followup) => (
              <span
                key={followup}
                className="rounded-full border border-[color:var(--border)] bg-black/15 px-3 py-1 text-[0.74rem] text-slate-300"
              >
                {followup}
              </span>
            ))}
          </div>
        </div>
      );

    case 'standings_table':
      return (
        <div className="space-y-4 rounded-[24px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-sm font-semibold text-white">{view.title}</p>
            {view.unavailableTables.length > 0 && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[0.72rem] text-amber-200">
                Missing: {view.unavailableTables.join(', ')}
              </span>
            )}
          </div>
          {view.tables.map((table) =>
            table.key === 'drivers' ? (
              <div key={table.key}>
                <p className="m-0 mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {table.title}
                </p>
                <div className="overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-black/18">
                  <table className="min-w-full text-left text-[0.84rem]">
                    <thead className="bg-white/6 text-slate-300">
                      <tr>
                        <th className="px-3 py-2 font-medium">Pos</th>
                        <th className="px-3 py-2 font-medium">Driver</th>
                        <th className="px-3 py-2 font-medium">Team</th>
                        <th className="px-3 py-2 font-medium">Points</th>
                        <th className="px-3 py-2 font-medium">Wins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={`${table.key}-${row.position}-${row.driverName}`} className="border-t border-white/6">
                          <td className="px-3 py-2 text-slate-200">{row.position}</td>
                          <td className="px-3 py-2 text-slate-100">{row.driverName}</td>
                          <td className="px-3 py-2 text-slate-300">{row.teamName}</td>
                          <td className="px-3 py-2 text-slate-100">{formatValue(row.points)}</td>
                          <td className="px-3 py-2 text-slate-100">{formatValue(row.wins)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div key={table.key}>
                <p className="m-0 mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {table.title}
                </p>
                <div className="overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-black/18">
                  <table className="min-w-full text-left text-[0.84rem]">
                    <thead className="bg-white/6 text-slate-300">
                      <tr>
                        <th className="px-3 py-2 font-medium">Pos</th>
                        <th className="px-3 py-2 font-medium">Team</th>
                        <th className="px-3 py-2 font-medium">Points</th>
                        <th className="px-3 py-2 font-medium">Wins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr
                          key={`${table.key}-${row.position}-${row.constructorName}`}
                          className="border-t border-white/6"
                        >
                          <td className="px-3 py-2 text-slate-200">{row.position}</td>
                          <td className="px-3 py-2 text-slate-100">{row.constructorName}</td>
                          <td className="px-3 py-2 text-slate-100">{formatValue(row.points)}</td>
                          <td className="px-3 py-2 text-slate-100">{formatValue(row.wins)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          )}
        </div>
      );

    case 'next_races_list':
      return (
        <div className="space-y-3 rounded-[22px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-sm font-semibold text-white">{view.title}</p>
            {view.season && (
              <span className="rounded-full border border-[color:var(--border)] bg-black/18 px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-slate-400">
                {view.season} season
              </span>
            )}
          </div>
          {view.races.map((race) => (
            <div
              key={`${race.round}-${race.raceName}`}
              className="rounded-[18px] border border-[color:var(--border)] bg-black/16 px-4 py-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="m-0 text-[0.98rem] font-semibold text-slate-100">{race.raceName}</p>
                  <p className="mt-1 mb-0 text-sm leading-6 text-slate-300">
                    {race.circuitName}
                  </p>
                  <p className="m-0 text-[0.82rem] text-slate-400">
                    {race.locality}, {race.country}
                  </p>
                </div>
                <span className="rounded-full border border-[color:var(--border)] bg-white/4 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-slate-400">
                  Round {race.round}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[0.78rem] text-slate-300">
                <span className="rounded-full bg-white/5 px-3 py-1.5">Date: {formatDateLabel(race.date)}</span>
                {race.userLocalTime && (
                  <span className="rounded-full bg-white/5 px-3 py-1.5">Your time: {race.userLocalTime}</span>
                )}
                {race.circuitLocalTime && (
                  <span className="rounded-full bg-white/5 px-3 py-1.5">
                    Circuit time: {race.circuitLocalTime}
                  </span>
                )}
                {race.hasSprint && (
                  <span className="rounded-full bg-[#1b2740] px-3 py-1.5 text-sky-200">Sprint weekend</span>
                )}
              </div>
            </div>
          ))}
        </div>
      );

    case 'race_result':
      return (
        <div className="space-y-4 rounded-[24px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold text-white">{view.title}</p>
              <p className="mt-1 mb-0 text-[0.8rem] text-slate-400">
                {view.circuit.name} / {view.circuit.locality}, {view.circuit.country}
              </p>
            </div>
            <span className="rounded-full border border-[color:var(--border)] bg-black/15 px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-slate-300">
              {view.sessionType}
            </span>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-black/18">
            <table className="min-w-full text-left text-[0.84rem]">
              <thead className="bg-white/6 text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Pos</th>
                  <th className="px-3 py-2 font-medium">Driver</th>
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 font-medium">Pts</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.results.map((result) => (
                  <tr
                    key={`${result.position}-${result.driverName}-${result.teamName}`}
                    className="border-t border-white/6"
                  >
                    <td className="px-3 py-2 text-slate-200">{result.position}</td>
                    <td className="px-3 py-2 text-slate-100">{result.driverName}</td>
                    <td className="px-3 py-2 text-slate-300">{result.teamName}</td>
                    <td className="px-3 py-2 text-slate-100">{formatValue(result.points)}</td>
                    <td className="px-3 py-2 text-slate-300">{result.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

    case 'clarification':
      return (
        <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="m-0 text-sm font-semibold text-amber-100">{view.title}</p>
          <p className="mt-2 mb-0 text-sm leading-6 text-amber-50">{view.message}</p>
          <ul className="mt-3 mb-0 space-y-1 pl-4 text-[0.82rem] text-amber-100">
            {view.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>
      );

    case 'error':
      return (
        <div className="rounded-[24px] border border-rose-500/30 bg-rose-500/10 p-4">
          <p className="m-0 text-sm font-semibold text-rose-100">{view.title}</p>
          <p className="mt-2 mb-0 text-sm leading-6 text-rose-50">{view.message}</p>
        </div>
      );
  }
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const wideStructuredView =
    message.view?.type === 'standings_table' ||
    message.view?.type === 'next_races_list' ||
    message.view?.type === 'race_result';

  if (isUser) {
    return (
      <div className="my-4 flex justify-end">
        <div className="w-full max-w-[min(68%,560px)]">
          <div className="rounded-[22px] rounded-tr-sm bg-[linear-gradient(180deg,#df3348,#c12238)] px-4 py-3 text-[0.92rem] leading-6 text-white shadow-[0_14px_28px_rgba(0,0,0,0.2)]">
            {message.content}
          </div>
          {message.refinedQuery && <RefinedQueryLabel refinedQuery={message.refinedQuery} />}
        </div>
      </div>
    );
  }

  const html = renderAssistantHtml(message.content);

  return (
    <div className="my-4 flex items-start gap-3">
      <div
        className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#f04558,#d92a3f)] text-[0.72rem] font-bold text-white shadow-[0_10px_22px_rgba(217,42,63,0.28)]"
        aria-hidden="true"
      >
        B
      </div>
      <div
        className={`rounded-[24px] rounded-tl-sm border border-[color:var(--border)] bg-[linear-gradient(180deg,#151c2b,#101521)] px-4 py-4 text-[0.94rem] leading-7 text-slate-100 shadow-[0_14px_28px_rgba(0,0,0,0.16)] ${
          wideStructuredView
            ? 'w-full max-w-[min(95%,980px)]'
            : 'max-w-[min(88%,820px)]'
        }`}
      >
        <div className="space-y-3">
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
          {message.view && <StructuredView view={message.view} />}
        </div>
      </div>
    </div>
  );
}
