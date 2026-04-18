import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ScheduleConfig, SecretEntry } from '../types';
import { Icon, Toggle } from '../components/Pills';

const FREQ_OPTIONS = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: 'daily' },
];

interface Props {
  onRunNow: (dry?: boolean) => void;
  keysReady: boolean;
}

export function Settings({ onRunNow, keysReady }: Props) {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [nextRuns, setNextRuns] = useState<number[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadAll = async () => {
    try {
      const [s, sch, runs] = await Promise.all([
        api.readSecrets(false),
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
    loadAll();
  }, []);

  const updateSecret = (key: string, value: string) => {
    setSecrets((prev) =>
      prev.map((s) => (s.key === key ? { ...s, value } : s)),
    );
    setDirty(true);
  };

  const revealKey = async (key: string) => {
    // Request unmasked value from backend for this one key
    try {
      const unmasked = await api.readSecrets(true);
      const entry = unmasked.find((s) => s.key === key);
      if (entry) {
        setSecrets((prev) => prev.map((s) => (s.key === key ? entry : s)));
        setRevealed({ ...revealed, [key]: true });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const save = async () => {
    try {
      await api.writeSecrets(secrets);
      if (schedule) await api.setSchedule(schedule);
      const runs = await api.getNextRuns(3);
      setNextRuns(runs);
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(null), 2500);
      setDirty(false);
      await loadAll();
      setRevealed({});
    } catch (e) {
      setError(String(e));
    }
  };

  const getSecret = (key: string) => secrets.find((s) => s.key === key);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">
            {keysReady ? 'Configured' : 'Required keys missing'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={loadAll}>
            <Icon name="refresh" size={11} /> Reload
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>
            <Icon name="check" size={12} /> Save changes
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {saveMsg && <div className="success-banner">{saveMsg}</div>}

      {/* API Keys */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">API Keys</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MaskedField
            label="OpenRouter API key"
            entry={getSecret('OPENROUTER_API_KEY')}
            revealed={!!revealed.OPENROUTER_API_KEY}
            onReveal={() => revealKey('OPENROUTER_API_KEY')}
            onChange={(v) => updateSecret('OPENROUTER_API_KEY', v)}
          />
          <MaskedField
            label="Discord bot token"
            entry={getSecret('DISCORD_BOT_TOKEN')}
            revealed={!!revealed.DISCORD_BOT_TOKEN}
            onReveal={() => revealKey('DISCORD_BOT_TOKEN')}
            onChange={(v) => updateSecret('DISCORD_BOT_TOKEN', v)}
          />
          <LabeledField
            label="Discord user ID"
            hint="Where daily digests are DM'd"
          >
            <input
              className="input mono"
              value={getSecret('DISCORD_USER_ID')?.value ?? ''}
              onChange={(e) => updateSecret('DISCORD_USER_ID', e.target.value)}
            />
          </LabeledField>
          <MaskedField
            label="Discord webhook URL"
            hint="Optional fallback if bot DM fails"
            entry={getSecret('DISCORD_WEBHOOK_URL')}
            revealed={!!revealed.DISCORD_WEBHOOK_URL}
            onReveal={() => revealKey('DISCORD_WEBHOOK_URL')}
            onChange={(v) => updateSecret('DISCORD_WEBHOOK_URL', v)}
          />
        </div>
      </div>

      {/* Schedule */}
      {schedule && (
        <div className="panel" style={{ padding: 24 }}>
          <div className="section-title">Schedule</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16, marginBottom: 14 }}>
            <LabeledField label="Frequency">
              <div
                className="segmented"
                style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}
              >
                {FREQ_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={schedule.interval_minutes === o.value ? 'on' : ''}
                    onClick={() => {
                      setSchedule({ ...schedule, interval_minutes: o.value });
                      setDirty(true);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </LabeledField>
            <LabeledField label="Active hours — start">
              <input
                className="input mono"
                type="number"
                min="0"
                max="23"
                value={schedule.active_hour_start ?? ''}
                onChange={(e) => {
                  setSchedule({
                    ...schedule,
                    active_hour_start: e.target.value ? parseInt(e.target.value) : null,
                  });
                  setDirty(true);
                }}
                placeholder="0–23"
              />
            </LabeledField>
            <LabeledField label="Active hours — end">
              <input
                className="input mono"
                type="number"
                min="0"
                max="23"
                value={schedule.active_hour_end ?? ''}
                onChange={(e) => {
                  setSchedule({
                    ...schedule,
                    active_hour_end: e.target.value ? parseInt(e.target.value) : null,
                  });
                  setDirty(true);
                }}
                placeholder="0–23"
              />
            </LabeledField>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Enable automatic runs</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                App must be open (in tray) for the scheduler to fire
              </div>
            </div>
            <Toggle
              on={schedule.enabled}
              onClick={() => {
                setSchedule({ ...schedule, enabled: !schedule.enabled });
                setDirty(true);
              }}
            />
          </div>

          <div
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 14,
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}
            >
              Next 3 scheduled runs
            </div>
            {nextRuns.length === 0 ? (
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                (not scheduled)
              </div>
            ) : (
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                {nextRuns.map((ts, i) => {
                  const d = new Date(ts);
                  const diff = ts - Date.now();
                  const mins = Math.max(0, Math.floor(diff / 60_000));
                  const until =
                    mins < 60
                      ? `in ${mins}m`
                      : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
                  return (
                    <span
                      key={i}
                      style={{ color: i === 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}
                    >
                      {i === 0 ? (
                        <span style={{ color: 'var(--accent-text)' }}>▸ </span>
                      ) : (
                        '  '
                      )}
                      {d.toLocaleString()}
                      <span style={{ color: 'var(--text-dim)' }}> — {until}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LLM models */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">LLM</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <LabeledField
            label="Primary model"
            hint="Pass 1 — fast filter"
          >
            <input
              className="input mono"
              value={getSecret('OPENROUTER_MODEL')?.value ?? ''}
              onChange={(e) => updateSecret('OPENROUTER_MODEL', e.target.value)}
              placeholder="e.g. deepseek/deepseek-chat-v3.1"
            />
          </LabeledField>
          <LabeledField
            label="Fallback model"
            hint="Used if primary fails"
          >
            <input
              className="input mono"
              value={getSecret('OPENROUTER_FALLBACK_MODEL')?.value ?? ''}
              onChange={(e) => updateSecret('OPENROUTER_FALLBACK_MODEL', e.target.value)}
              placeholder="e.g. z-ai/glm-4.7-flash"
            />
          </LabeledField>
        </div>
      </div>

      {/* Browser */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">Browser</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Headless mode</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
              Run Chromium without a visible window (FBMP still forces headed)
            </div>
          </div>
          <Toggle
            on={(getSecret('HEADLESS')?.value ?? 'true') !== 'false'}
            onClick={() => {
              const current = getSecret('HEADLESS')?.value ?? 'true';
              updateSecret('HEADLESS', current === 'false' ? 'true' : 'false');
            }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <LabeledField label="Min delay (ms)">
            <input
              className="input mono"
              type="number"
              value={getSecret('SCRAPE_DELAY_MIN')?.value ?? ''}
              onChange={(e) => updateSecret('SCRAPE_DELAY_MIN', e.target.value)}
              placeholder="2000"
            />
          </LabeledField>
          <LabeledField label="Max delay (ms)">
            <input
              className="input mono"
              type="number"
              value={getSecret('SCRAPE_DELAY_MAX')?.value ?? ''}
              onChange={(e) => updateSecret('SCRAPE_DELAY_MAX', e.target.value)}
              placeholder="5000"
            />
          </LabeledField>
        </div>
      </div>

      {/* Actions */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">Run actions</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn"
            onClick={() => onRunNow(true)}
            title="Skips LLM + notifications"
          >
            Dry run
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onRunNow(false)}
            disabled={!keysReady}
          >
            <Icon name="play" size={12} /> Full run now
          </button>
          {!keysReady && (
            <span
              className="faint"
              style={{ alignSelf: 'center', fontSize: 11 }}
            >
              Save API keys above first
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function LabeledField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function MaskedField({
  label,
  hint,
  entry,
  revealed,
  onReveal,
  onChange,
}: {
  label: string;
  hint?: string;
  entry: SecretEntry | undefined;
  revealed: boolean;
  onReveal: () => void;
  onChange: (v: string) => void;
}) {
  if (!entry) return null;
  return (
    <LabeledField label={label} hint={hint}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type={revealed ? 'text' : 'password'}
            className="input mono"
            value={entry.value}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            className="link-button"
            onClick={(e) => {
              e.preventDefault();
              if (!revealed) onReveal();
              // (no collapse back — simpler UX; save cycles re-mask anyway)
            }}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
            title={revealed ? 'Revealed' : 'Show'}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={14} />
          </button>
        </div>
      </div>
    </LabeledField>
  );
}
