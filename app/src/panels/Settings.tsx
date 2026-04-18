import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ScheduleConfig, SecretEntry } from '../types';
import { Icon, Toggle } from '../components/Pills';
import { MODEL_CATALOG, findModel, formatDailyCost } from '../models';

const FREQ_OPTIONS = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: 'daily' },
];

export function Settings({ keysReady: _keysReady }: { keysReady: boolean }) {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [nextRuns, setNextRuns] = useState<number[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dataOpMsg, setDataOpMsg] = useState<string | null>(null);

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
    setSecrets((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
    setDirty(true);
  };

  const revealKey = async (key: string) => {
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

  const revert = async () => {
    await loadAll();
    setRevealed({});
    setDirty(false);
  };

  const getSecret = (key: string) => secrets.find((s) => s.key === key);

  const exportBackup = async () => {
    try {
      const path = await api.exportBackup();
      setDataOpMsg(`Exported to: ${path}`);
      setTimeout(() => setDataOpMsg(null), 6000);
    } catch (e) {
      setError(String(e));
    }
  };

  const wipeDb = async () => {
    const confirmed = confirm(
      'Wipe ALL listing history? This deletes every seen item and evaluation. The YAML config stays. Continue?',
    );
    if (!confirmed) return;
    try {
      const n = await api.wipeDatabase();
      setDataOpMsg(`Deleted ${n.toLocaleString()} listings. Database is fresh.`);
      setTimeout(() => setDataOpMsg(null), 6000);
    } catch (e) {
      setError(String(e));
    }
  };

  const schedEnabled = schedule?.enabled ?? false;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">API keys, schedule, models, data</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {saveMsg && <div className="success-banner">{saveMsg}</div>}
      {dataOpMsg && <div className="success-banner">{dataOpMsg}</div>}

      {/* ===== API Keys ===== */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">API Keys</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MaskedField
            label="OpenRouter API key"
            hint="Required — powers the LLM evaluation"
            entry={getSecret('OPENROUTER_API_KEY')}
            revealed={!!revealed.OPENROUTER_API_KEY}
            onReveal={() => revealKey('OPENROUTER_API_KEY')}
            onChange={(v) => updateSecret('OPENROUTER_API_KEY', v)}
          />
          <MaskedField
            label="Discord bot token"
            hint="Required — sends deal DMs"
            entry={getSecret('DISCORD_BOT_TOKEN')}
            revealed={!!revealed.DISCORD_BOT_TOKEN}
            onReveal={() => revealKey('DISCORD_BOT_TOKEN')}
            onChange={(v) => updateSecret('DISCORD_BOT_TOKEN', v)}
          />
          <LabeledField label="Discord user ID" hint="Your Discord ID — the DM recipient">
            <input
              className="input mono"
              value={getSecret('DISCORD_USER_ID')?.value ?? ''}
              onChange={(e) => updateSecret('DISCORD_USER_ID', e.target.value)}
            />
          </LabeledField>
          <MaskedField
            label="Discord webhook URL"
            hint="Optional — fallback if DMs fail"
            entry={getSecret('DISCORD_WEBHOOK_URL')}
            revealed={!!revealed.DISCORD_WEBHOOK_URL}
            onReveal={() => revealKey('DISCORD_WEBHOOK_URL')}
            onChange={(v) => updateSecret('DISCORD_WEBHOOK_URL', v)}
          />
        </div>
      </div>

      {/* ===== LLM Models ===== */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">LLM models</div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            marginBottom: 14,
            marginTop: -4,
          }}
        >
          Cost estimates assume ~100 listings per run with 3 pass-2 drill-downs. Real cost
          varies with your targets.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ModelDropdown
            label="Primary model"
            hint="Pass 1 — fast batch filter"
            value={getSecret('OPENROUTER_MODEL')?.value ?? ''}
            onChange={(v) => updateSecret('OPENROUTER_MODEL', v)}
          />
          <ModelDropdown
            label="Fallback model"
            hint="Used if primary errors"
            value={getSecret('OPENROUTER_FALLBACK_MODEL')?.value ?? ''}
            onChange={(v) => updateSecret('OPENROUTER_FALLBACK_MODEL', v)}
          />
        </div>
      </div>

      {/* ===== Schedule ===== */}
      {schedule && (
        <div className="panel" style={{ padding: 24 }}>
          <div className="section-title">Schedule</div>

          {/* Enable toggle comes FIRST */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Automatic runs</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {schedEnabled
                  ? 'Deal Hunter will scan on a recurring interval while the app is open.'
                  : 'Disabled — scans only happen when you click Run now.'}
              </div>
            </div>
            <Toggle
              on={schedEnabled}
              onClick={() => {
                setSchedule({ ...schedule, enabled: !schedule.enabled });
                setDirty(true);
              }}
            />
          </div>

          {/* All other controls disabled when schedule is off */}
          <fieldset
            disabled={!schedEnabled}
            style={{
              border: 'none',
              padding: 0,
              margin: 0,
              opacity: schedEnabled ? 1 : 0.5,
              pointerEvents: schedEnabled ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr',
                gap: 16,
                marginBottom: 14,
              }}
            >
              <LabeledField label="How often to run">
                <div
                  className="segmented"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                  }}
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
              <LabeledField
                label="Only scan from (hour)"
                hint="Optional — leave blank for 24/7"
              >
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
                  placeholder="e.g. 8"
                />
              </LabeledField>
              <LabeledField label="Until (hour)" hint="24h format, 0–23">
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
                  placeholder="e.g. 23"
                />
              </LabeledField>
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
              {!schedEnabled ? (
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  (not scheduled)
                </div>
              ) : nextRuns.length === 0 ? (
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  (save to compute)
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
                        style={{
                          color: i === 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                        }}
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
          </fieldset>
        </div>
      )}

      {/* ===== Browser ===== */}
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
          <LabeledField label="Min delay (ms)" hint="Between requests, per site">
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

      {/* ===== Data management ===== */}
      <div className="panel" style={{ padding: 24 }}>
        <div className="section-title">Data</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            className="btn"
            onClick={exportBackup}
            style={{
              padding: '12px 14px',
              textAlign: 'left',
              height: 'auto',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              width: '100%',
              justifyContent: 'flex-start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="download" size={12} />
              <span style={{ fontWeight: 500 }}>Export target config</span>
            </div>
            <span
              style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}
            >
              Writes a timestamped copy of price-reference.yaml to backups/
            </span>
          </button>
          <button
            className="btn btn-danger"
            onClick={wipeDb}
            style={{
              padding: '12px 14px',
              textAlign: 'left',
              height: 'auto',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              width: '100%',
              justifyContent: 'flex-start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="trash" size={12} />
              <span style={{ fontWeight: 500 }}>Wipe listing database</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              Deletes every seen listing. Config stays. Re-dedup from scratch.
            </span>
          </button>
        </div>
      </div>

      {/* Floating save bar — shown only when there are unsaved changes */}
      {dirty && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 50,
          }}
        >
          <span
            className="pip warn"
            style={{ width: 8, height: 8, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Unsaved changes
          </span>
          <button className="btn btn-sm" onClick={revert}>
            Discard
          </button>
          <button className="btn btn-sm btn-primary" onClick={save}>
            <Icon name="check" size={11} /> Save changes
          </button>
        </div>
      )}
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
        {hint && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hint}</span>}
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
      <div style={{ position: 'relative' }}>
        <input
          type={revealed ? 'text' : 'password'}
          className="input mono"
          value={entry.value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          onClick={(e) => {
            e.preventDefault();
            if (!revealed) onReveal();
          }}
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
          }}
          title={revealed ? 'Revealed' : 'Show'}
        >
          <Icon name={revealed ? 'eyeOff' : 'eye'} size={14} />
        </button>
      </div>
    </LabeledField>
  );
}

function ModelDropdown({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const known = findModel(value);
  const isCustom = value && !known;

  return (
    <LabeledField label={label} hint={hint}>
      <select
        className="select mono"
        value={isCustom ? '__custom__' : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom__') {
            // keep current value; let the text field take over
            return;
          }
          onChange(v);
        }}
      >
        <option value="">— unset —</option>
        {MODEL_CATALOG.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {formatDailyCost(m)}
          </option>
        ))}
        <option value="__custom__">Custom model ID…</option>
      </select>
      {known && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>
          <span className="mono">{known.id}</span>
          {known.note && <span> — {known.note}</span>}
        </div>
      )}
      {isCustom && (
        <input
          className="input mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="vendor/model-id"
          style={{ marginTop: 6 }}
        />
      )}
    </LabeledField>
  );
}
