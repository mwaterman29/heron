import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ScheduleConfig, SecretEntry } from '../types';

const SECRET_LABELS: Record<string, string> = {
  OPENROUTER_API_KEY: 'OpenRouter API key',
  OPENROUTER_MODEL: 'Primary LLM model',
  OPENROUTER_FALLBACK_MODEL: 'Fallback LLM model',
  DISCORD_BOT_TOKEN: 'Discord bot token',
  DISCORD_USER_ID: 'Discord user ID',
  DISCORD_WEBHOOK_URL: 'Discord webhook URL (optional)',
  LOG_LEVEL: 'Log level',
  HEADLESS: 'Headless browser',
  SCRAPE_DELAY_MIN: 'Scrape delay min (ms)',
  SCRAPE_DELAY_MAX: 'Scrape delay max (ms)',
};

const SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: 'LLM (OpenRouter)',
    keys: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_FALLBACK_MODEL'],
  },
  {
    title: 'Discord',
    keys: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'DISCORD_WEBHOOK_URL'],
  },
  {
    title: 'Scraping',
    keys: ['HEADLESS', 'SCRAPE_DELAY_MIN', 'SCRAPE_DELAY_MAX', 'LOG_LEVEL'],
  },
];

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: 'Daily' },
];

interface Props {
  onRunNow: (dry?: boolean) => void;
}

export function Settings({ onRunNow }: Props) {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [nextRuns, setNextRuns] = useState<number[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async (reveal = false) => {
    try {
      const [s, sch, runs] = await Promise.all([
        api.readSecrets(reveal),
        api.getSchedule(),
        api.getNextRuns(3),
      ]);
      setSecrets(s);
      setSchedule(sch);
      setNextRuns(runs);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    loadAll(false);
  }, []);

  const toggleReveal = async () => {
    const next = !revealed;
    setRevealed(next);
    await loadAll(next);
  };

  const updateSecret = (key: string, value: string) => {
    setSecrets((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  const saveSecrets = async () => {
    try {
      await api.writeSecrets(secrets);
      setSaveMsg('Secrets saved.');
      setTimeout(() => setSaveMsg(null), 3000);
      // Reload to re-mask
      await loadAll(false);
      setRevealed(false);
    } catch (e) {
      setError(String(e));
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    try {
      await api.setSchedule(schedule);
      const runs = await api.getNextRuns(3);
      setNextRuns(runs);
      setSaveMsg('Schedule saved.');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Settings</h2>
          <div className="subtitle">API keys, schedule, and scraper configuration.</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {saveMsg && (
        <div
          className="error-banner"
          style={{ background: 'var(--success-bg)', color: '#d1fae5' }}
        >
          {saveMsg}
        </div>
      )}

      {/* Schedule */}
      <div className="card">
        <div className="section-heading">
          <h3>Schedule</h3>
          <div className="actions">
            <button className="btn sm" onClick={saveSchedule} disabled={!schedule}>
              Save schedule
            </button>
          </div>
        </div>
        {schedule && (
          <div className="stack">
            <label className="field">
              <span className="field-label">Enabled</span>
              <div className="row">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={(e) =>
                    setSchedule({ ...schedule, enabled: e.target.checked })
                  }
                />
                <span className="faint" style={{ fontSize: 12 }}>
                  Run on a recurring interval (app must be open)
                </span>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Interval</span>
              <select
                value={schedule.interval_minutes}
                onChange={(e) =>
                  setSchedule({
                    ...schedule,
                    interval_minutes: parseInt(e.target.value),
                  })
                }
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="row" style={{ gap: 16 }}>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">Active hour start (optional)</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={schedule.active_hour_start ?? ''}
                  onChange={(e) =>
                    setSchedule({
                      ...schedule,
                      active_hour_start: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="e.g. 9"
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">Active hour end (optional)</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={schedule.active_hour_end ?? ''}
                  onChange={(e) =>
                    setSchedule({
                      ...schedule,
                      active_hour_end: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="e.g. 22"
                />
              </label>
            </div>
            {nextRuns.length > 0 && (
              <div>
                <div className="stat-label" style={{ marginBottom: 6 }}>Next 3 runs</div>
                <ul style={{ listStyle: 'none', fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {nextRuns.map((ts, i) => (
                    <li key={i} className="muted">
                      {new Date(ts).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Secrets */}
      {SECTIONS.map((section) => (
        <div key={section.title} className="card">
          <div className="section-heading">
            <h3>{section.title}</h3>
            {section.keys.some((k) => secrets.find((s) => s.key === k)?.is_secret) && (
              <div className="actions">
                <button className="btn sm" onClick={toggleReveal}>
                  {revealed ? 'Hide' : 'Reveal'}
                </button>
              </div>
            )}
          </div>
          <div className="stack">
            {section.keys.map((key) => {
              const entry = secrets.find((s) => s.key === key);
              if (!entry) return null;
              const isBool = key === 'HEADLESS';
              const isNum = key === 'SCRAPE_DELAY_MIN' || key === 'SCRAPE_DELAY_MAX';
              return (
                <label key={key} className="field" style={{ marginBottom: 0 }}>
                  <span className="field-label">
                    {SECRET_LABELS[key] ?? key}
                    {entry.is_secret && (
                      <span className="faint" style={{ marginLeft: 8, fontSize: 10 }}>
                        (secret)
                      </span>
                    )}
                    {entry.is_set && (
                      <span
                        className="pill success"
                        style={{ marginLeft: 8, fontSize: 9, padding: '1px 6px' }}
                      >
                        set
                      </span>
                    )}
                  </span>
                  {isBool ? (
                    <select
                      value={entry.value}
                      onChange={(e) => updateSecret(key, e.target.value)}
                    >
                      <option value="">(unset)</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      type={entry.is_secret && !revealed ? 'password' : 'text'}
                      inputMode={isNum ? 'numeric' : 'text'}
                      value={entry.value}
                      onChange={(e) => updateSecret(key, e.target.value)}
                      placeholder={entry.is_set ? '' : `Set ${key}`}
                    />
                  )}
                </label>
              );
            })}
            <div style={{ marginTop: 8 }}>
              <button className="btn sm primary" onClick={saveSecrets}>
                Save {section.title}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Test actions */}
      <div className="card">
        <h3>Test actions</h3>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => onRunNow(true)}>
            Dry-run hunt (no notifications)
          </button>
          <button className="btn sm" onClick={() => onRunNow(false)}>
            Full run now
          </button>
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Dry run skips LLM calls and sends notifications to the console instead of Discord.
        </div>
      </div>
    </div>
  );
}
