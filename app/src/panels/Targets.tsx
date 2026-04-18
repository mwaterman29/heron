import { useEffect, useMemo, useState } from 'react';
import yaml from 'js-yaml';
import { api } from '../api';
import { SCRAPER_META } from '../types';
import { Icon, Segmented, SourceIcon, Toggle, ItemThumb } from '../components/Pills';

const STATES_US = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL',
  'IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE',
  'NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VA','VT','WA','WI','WV','WY',
];

interface Variant {
  model?: string;
  name?: string;
  msrp?: number;
  fair_used?: number;
  fair?: number;
  deal_price?: number;
  steal_price?: number;
}

interface SiteOverride {
  query?: string;
  queries?: string[];
  location?: string;
}

interface PriceReference {
  id: string;
  name: string;
  type: string;
  category?: string;
  query?: string;
  queries?: string[];
  sites?: string[];
  site_overrides?: Record<string, SiteOverride>;
  location?: string;
  msrp?: number;
  fair_used?: number;
  fair_price?: number;
  deal_price?: number;
  steal_price?: number;
  variants?: Variant[];
  grail?: string;
  notes?: string;
  shipping_notes?: string;
  allowed_states?: string[];
  profile?: string;
  enabled?: boolean; // UI-only; not in current YAML but we treat missing sites[] as disabled
}

interface UserProfile {
  location?: string;
}

interface ConfigShape {
  user?: UserProfile;
  references: PriceReference[];
}

type Kind = 'exact' | 'hunt';
type Tab = 'config' | 'queries' | 'raw';

function detectKind(ref: PriceReference): Kind {
  return ref.profile ? 'hunt' : 'exact';
}

function isEnabled(ref: PriceReference): boolean {
  return (ref.sites?.length ?? 0) > 0 && ref.enabled !== false;
}

export function Targets() {
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [rawYaml, setRawYaml] = useState<string>('');
  const [rawMode, setRawMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    try {
      const content = await api.readConfig();
      setRawYaml(content);
      try {
        const parsed = (yaml.load(content) as ConfigShape) ?? { references: [] };
        if (!parsed.references) parsed.references = [];
        setConfig(parsed);
        setParseError(null);
        if (!selectedId && parsed.references.length > 0) {
          setSelectedId(parsed.references[0].id);
        }
      } catch (e) {
        setParseError(String(e));
      }
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    try {
      let toSave: string;
      if (rawMode) {
        try {
          yaml.load(rawYaml);
        } catch (e) {
          setError(`YAML parse error: ${e}`);
          return;
        }
        toSave = rawYaml;
      } else if (config) {
        toSave = yaml.dump(config, { indent: 2, lineWidth: 120, noRefs: true });
      } else {
        return;
      }
      await api.writeConfig(toSave);
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(null), 2500);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const updateRef = (id: string, patch: Partial<PriceReference>) => {
    if (!config) return;
    setConfig({
      ...config,
      references: config.references.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
    setDirty(true);
  };

  const addNew = (kind: Kind) => {
    if (!config) return;
    const id = `new-${Date.now().toString(36)}`;
    const base: PriceReference = {
      id,
      name: 'New target',
      type: kind === 'exact' ? 'item' : 'category_hunt',
      sites: ['hifishark'],
      query: '',
    };
    if (kind === 'hunt') base.profile = '';
    setConfig({ ...config, references: [...config.references, base] });
    setSelectedId(id);
    setDirty(true);
  };

  const duplicate = (id: string) => {
    if (!config) return;
    const ref = config.references.find((r) => r.id === id);
    if (!ref) return;
    const newId = `${ref.id}-copy-${Date.now().toString(36)}`;
    const copy = { ...ref, id: newId, name: `${ref.name} (copy)` };
    setConfig({ ...config, references: [...config.references, copy] });
    setSelectedId(newId);
    setDirty(true);
  };

  const remove = (id: string) => {
    if (!config) return;
    const ref = config.references.find((r) => r.id === id);
    if (!ref) return;
    if (!confirm(`Delete "${ref.name}"?`)) return;
    setConfig({ ...config, references: config.references.filter((r) => r.id !== id) });
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  };

  const filtered = useMemo(() => {
    if (!config) return [];
    return config.references.filter((r) =>
      r.name.toLowerCase().includes(query.toLowerCase()),
    );
  }, [config, query]);

  const selected = config?.references.find((r) => r.id === selectedId) ?? null;
  const activeCount = config?.references.filter(isEnabled).length ?? 0;
  const totalCount = config?.references.length ?? 0;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Targets</div>
          <div className="page-subtitle">
            {activeCount} active · {totalCount} total
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Segmented
            options={[
              { value: 'form' as const, label: 'Form' },
              { value: 'yaml' as const, label: 'Raw YAML' },
            ]}
            value={rawMode ? 'yaml' : 'form'}
            onChange={(v) => setRawMode(v === 'yaml')}
          />
          <button className="btn" onClick={load}>
            <Icon name="refresh" size={11} /> Reload
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty && !rawMode}>
            <Icon name="check" size={12} /> Save
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {parseError && <div className="error-banner">YAML parse error: {parseError}</div>}
      {saveMsg && <div className="success-banner">{saveMsg}</div>}

      {rawMode ? (
        <div className="panel" style={{ padding: 16 }}>
          <div
            className="mono"
            style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}
          >
            config/price-reference.yaml
          </div>
          <textarea
            className="textarea mono"
            value={rawYaml}
            onChange={(e) => {
              setRawYaml(e.target.value);
              setDirty(true);
            }}
            style={{ minHeight: '60vh', fontSize: 12 }}
          />
        </div>
      ) : config ? (
        <div
          className="panel"
          style={{
            display: 'grid',
            gridTemplateColumns: '280px 1fr',
            height: 'calc(100vh - 180px)',
            overflow: 'hidden',
          }}
        >
          {/* LEFT: list */}
          <div
            style={{
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border)',
                position: 'relative',
              }}
            >
              <Icon
                name="search"
                size={13}
                style={{
                  position: 'absolute',
                  left: 22,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-dim)',
                  pointerEvents: 'none',
                }}
              />
              <input
                className="input"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 28 }}
              />
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {filtered.map((ref) => (
                <TargetListRow
                  key={ref.id}
                  ref_={ref}
                  active={ref.id === selectedId}
                  onClick={() => setSelectedId(ref.id)}
                />
              ))}
              <div style={{ padding: 12, display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => addNew('exact')}>
                  <Icon name="plus" size={11} /> Exact
                </button>
                <button className="btn btn-sm" onClick={() => addNew('hunt')}>
                  <Icon name="plus" size={11} /> Hunt
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: editor */}
          <TargetEditor
            ref_={selected}
            onChange={(patch) => selected && updateRef(selected.id, patch)}
            onDuplicate={() => selected && duplicate(selected.id)}
            onDelete={() => selected && remove(selected.id)}
          />
        </div>
      ) : (
        <div className="empty-state">Loading…</div>
      )}
    </>
  );
}

function TargetListRow({
  ref_,
  active,
  onClick,
}: {
  ref_: PriceReference;
  active: boolean;
  onClick: () => void;
}) {
  const kind = detectKind(ref_);
  const enabled = isEnabled(ref_);
  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px',
        background: active ? 'var(--bg-raised)' : 'transparent',
        borderBottom: '1px solid color-mix(in oklab, var(--border) 50%, transparent)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: enabled ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {ref_.name}
          </span>
          <span
            className="chip"
            style={{
              fontSize: 10,
              padding: '1px 8px',
              background:
                kind === 'hunt'
                  ? 'color-mix(in oklab, var(--accent) 14%, transparent)'
                  : 'var(--bg-raised)',
              color: kind === 'hunt' ? 'var(--accent-text)' : 'var(--text-muted)',
              borderColor:
                kind === 'hunt'
                  ? 'color-mix(in oklab, var(--accent) 30%, var(--border))'
                  : 'var(--border)',
            }}
          >
            {kind === 'hunt' ? 'Hunt' : 'Exact'}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {ref_.category ?? ref_.type ?? 'general'} · {(ref_.sites ?? []).length} sources
        </div>
      </div>
      {!enabled && (
        <span
          className="chip"
          style={{ fontSize: 10, padding: '1px 8px', color: 'var(--text-dim)' }}
        >
          Off
        </span>
      )}
    </div>
  );
}

// ---------------- Editor ----------------

interface EditorProps {
  ref_: PriceReference | null;
  onChange: (patch: Partial<PriceReference>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function TargetEditor({ ref_, onChange, onDuplicate, onDelete }: EditorProps) {
  const [tab, setTab] = useState<Tab>('config');

  if (!ref_) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Select a target on the left to edit.
      </div>
    );
  }

  const kind = detectKind(ref_);
  const isHunt = kind === 'hunt';
  const enabled = isEnabled(ref_);

  const setKind = (k: Kind) => {
    if (k === 'hunt') {
      onChange({
        profile: ref_.profile ?? '',
        msrp: undefined,
        fair_used: undefined,
        deal_price: undefined,
        steal_price: undefined,
        variants: undefined,
        type: 'category_hunt',
      });
    } else {
      onChange({
        profile: undefined,
        type: ref_.type === 'category_hunt' ? 'item' : ref_.type,
      });
    }
  };

  const toggleEnabled = () => {
    if (enabled) {
      // "Disable" by clearing sites and remembering what was there via enabled: false flag
      onChange({ enabled: false });
    } else {
      onChange({ enabled: true });
    }
  };

  const toggleSite = (site: string) => {
    const sites = ref_.sites ?? [];
    const next = sites.includes(site) ? sites.filter((s) => s !== site) : [...sites, site];
    onChange({ sites: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <ItemThumb w={42} h={42} label="ITEM" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={ref_.name}
            onChange={(e) => onChange({ name: e.target.value })}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              padding: 0,
            }}
          />
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-muted)' }}
          >
            {ref_.category ?? ref_.type ?? 'general'} · id:{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{ref_.id}</span>
          </div>
        </div>
        <Segmented
          options={[
            { value: 'exact' as const, label: 'Exact' },
            { value: 'hunt' as const, label: 'Hunt' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Toggle on={enabled} onClick={toggleEnabled} />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          padding: '0 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        {(['config', 'queries', 'raw'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              textTransform: 'capitalize',
            }}
          >
            {t === 'raw' ? 'Raw YAML' : t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 40px', minHeight: 0 }}>
        {tab === 'config' && (
          <ConfigTab ref_={ref_} isHunt={isHunt} onChange={onChange} toggleSite={toggleSite} />
        )}
        {tab === 'queries' && <QueriesTab ref_={ref_} onChange={onChange} />}
        {tab === 'raw' && <RawTab ref_={ref_} isHunt={isHunt} />}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <button className="btn btn-sm" onClick={onDuplicate}>
          <Icon name="copy" size={11} /> Duplicate
        </button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          <Icon name="trash" size={11} /> Delete
        </button>
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-dim)' }}
        >
          Save from the top-right to persist changes
        </span>
      </div>
    </div>
  );
}

function ConfigTab({
  ref_,
  isHunt,
  onChange,
  toggleSite,
}: {
  ref_: PriceReference;
  isHunt: boolean;
  onChange: (patch: Partial<PriceReference>) => void;
  toggleSite: (site: string) => void;
}) {
  const sites = ref_.sites ?? [];
  const states = ref_.allowed_states ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {!isHunt ? (
        <section>
          <div className="section-title">Price Tiers (USD)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <PriceField
              label="MSRP"
              value={ref_.msrp}
              onChange={(v) => onChange({ msrp: v })}
            />
            <PriceField
              label="Fair used"
              value={ref_.fair_used}
              onChange={(v) => onChange({ fair_used: v })}
            />
            <PriceField
              label="Deal 🔥"
              value={ref_.deal_price}
              onChange={(v) => onChange({ deal_price: v })}
            />
            <PriceField
              label="Steal 🚨"
              value={ref_.steal_price}
              onChange={(v) => onChange({ steal_price: v })}
            />
          </div>
          {(ref_.steal_price || ref_.deal_price || ref_.fair_used) && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span className="mono" style={{ color: 'var(--text-dim)' }}>
                PREVIEW
              </span>
              <span className="mono">
                <span style={{ color: 'var(--tier-steal)' }}>
                  ≤${ref_.steal_price ?? '?'}
                </span>
                <span style={{ margin: '0 6px', color: 'var(--text-dim)' }}>→</span>
                <span style={{ color: 'var(--tier-deal)' }}>
                  ≤${ref_.deal_price ?? '?'}
                </span>
                <span style={{ margin: '0 6px', color: 'var(--text-dim)' }}>→</span>
                <span style={{ color: 'var(--tier-fair)' }}>
                  ≤${ref_.fair_used ?? '?'}
                </span>
                <span style={{ margin: '0 6px', color: 'var(--text-dim)' }}>→</span>
                <span style={{ color: 'var(--text-muted)' }}>above fair = skip</span>
              </span>
            </div>
          )}
        </section>
      ) : (
        <section>
          <div className="section-title">
            Buyer Profile
            <span
              style={{
                color: 'var(--text-dim)',
                fontSize: 10,
                fontWeight: 400,
              }}
            >
              — LLM evaluates listings against this
            </span>
          </div>
          <textarea
            className="textarea"
            rows={6}
            value={ref_.profile ?? ''}
            onChange={(e) => onChange({ profile: e.target.value })}
            placeholder="Describe what you're looking for — taste, budget, preferred brands, dealbreakers…"
          />
        </section>
      )}

      {!isHunt && (
        <section>
          <div className="section-title">
            Grail Description
            <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>
              optional · what would be a 💎 find?
            </span>
          </div>
          <textarea
            className="textarea"
            rows={2}
            value={ref_.grail ?? ''}
            onChange={(e) => onChange({ grail: e.target.value || undefined })}
            placeholder="e.g. OEM AMG wheels, <80k miles, documented service"
          />
        </section>
      )}

      {!isHunt && (
        <section>
          <div className="section-title">
            Notes
            <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>
              — domain knowledge, things to check
            </span>
          </div>
          <textarea
            className="textarea"
            rows={4}
            value={ref_.notes ?? ''}
            onChange={(e) => onChange({ notes: e.target.value || undefined })}
          />
        </section>
      )}

      <section>
        <div className="section-title">Shipping Notes</div>
        <textarea
          className="textarea"
          rows={2}
          value={ref_.shipping_notes ?? ''}
          onChange={(e) => onChange({ shipping_notes: e.target.value || undefined })}
        />
      </section>

      <section>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="section-title">
              Allowed States
              <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>
                — empty = any
              </span>
            </div>
            <TagInput
              tags={states}
              options={STATES_US}
              onChange={(next) =>
                onChange({ allowed_states: next.length > 0 ? next : undefined })
              }
              placeholder="Any state"
            />
          </div>
          <div>
            <div className="section-title">Sources to Search</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {Object.entries(SCRAPER_META).map(([site, meta]) => {
                const on = sites.includes(site);
                return (
                  <button
                    key={site}
                    onClick={() => toggleSite(site)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: on ? 'var(--bg-raised)' : 'var(--bg-input)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 4,
                      textAlign: 'left',
                    }}
                  >
                    <span className={`cbox ${on ? 'on' : ''}`} />
                    <SourceIcon id={site} size={18} />
                    <span style={{ fontSize: 12 }}>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function QueriesTab({
  ref_,
  onChange,
}: {
  ref_: PriceReference;
  onChange: (patch: Partial<PriceReference>) => void;
}) {
  const sites = ref_.sites ?? [];
  const overrides = ref_.site_overrides ?? {};

  const setOverride = (site: string, patch: Partial<SiteOverride>) => {
    const next = { ...(overrides[site] ?? {}), ...patch };
    const cleaned = Object.fromEntries(
      Object.entries(next).filter(([, v]) => v !== undefined && v !== ''),
    );
    const allOverrides = { ...overrides, [site]: cleaned };
    if (Object.keys(cleaned).length === 0) delete allOverrides[site];
    onChange({
      site_overrides:
        Object.keys(allOverrides).length > 0 ? (allOverrides as Record<string, SiteOverride>) : undefined,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section>
        <div className="section-title">Default query</div>
        <input
          className="input mono"
          value={ref_.query ?? ''}
          onChange={(e) => onChange({ query: e.target.value || undefined })}
          placeholder="e.g. W211 E500 or holy panda"
        />
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
          Used on all sources unless overridden below.
        </div>
      </section>

      <section>
        <div className="section-title">Multiple default queries (optional)</div>
        <textarea
          className="textarea mono"
          rows={3}
          value={(ref_.queries ?? []).join('\n')}
          onChange={(e) =>
            onChange({
              queries:
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean).length > 0
                  ? e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
                  : undefined,
            })
          }
          placeholder={'query A\nquery B'}
        />
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
          If set, takes precedence over the single default.
        </div>
      </section>

      <section>
        <div className="section-title">Per-source overrides</div>
        {sites.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            No sources selected. Add sources on the Config tab first.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sites.map((site) => {
            const meta = SCRAPER_META[site];
            return (
              <div
                key={site}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SourceIcon id={site} size={18} />
                  <span style={{ fontSize: 12 }}>{meta?.label ?? site}</span>
                </div>
                <input
                  className="input mono"
                  placeholder={`(default: ${ref_.query ?? '—'})`}
                  value={overrides[site]?.query ?? ''}
                  onChange={(e) => setOverride(site, { query: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RawTab({ ref_, isHunt }: { ref_: PriceReference; isHunt: boolean }) {
  const yamlText = yaml.dump(
    {
      id: ref_.id,
      name: ref_.name,
      type: isHunt ? 'category_hunt' : ref_.type ?? 'item',
      category: ref_.category,
      sites: ref_.sites ?? [],
      query: ref_.query,
      queries: ref_.queries,
      site_overrides: ref_.site_overrides,
      ...(isHunt
        ? { profile: ref_.profile }
        : {
            msrp: ref_.msrp,
            fair_used: ref_.fair_used,
            deal_price: ref_.deal_price,
            steal_price: ref_.steal_price,
            grail: ref_.grail,
            notes: ref_.notes,
          }),
      shipping_notes: ref_.shipping_notes,
      allowed_states: ref_.allowed_states,
    },
    { lineWidth: 100, noRefs: true },
  );
  return (
    <pre
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 14,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.65,
        color: 'var(--text-secondary)',
        overflow: 'auto',
        margin: 0,
        whiteSpace: 'pre-wrap',
      }}
    >
      {yamlText}
    </pre>
  );
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ position: 'relative' }}>
        <span
          className="mono"
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-dim)',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          $
        </span>
        <input
          className="input mono"
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          style={{ paddingLeft: 22 }}
        />
      </div>
    </div>
  );
}

function TagInput({
  tags,
  options,
  onChange,
  placeholder,
}: {
  tags: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '6px 8px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 5,
          minHeight: 32,
          cursor: 'text',
        }}
      >
        {tags.length === 0 && (
          <span style={{ color: 'var(--text-dim)', fontSize: 12, padding: '2px 4px' }}>
            {placeholder ?? 'Any'}
          </span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            className="chip mono"
            style={{ background: 'var(--bg-raised)' }}
          >
            {t}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange(tags.filter((x) => x !== t));
              }}
              style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              ×
            </span>
          </span>
        ))}
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 10,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            maxHeight: 240,
            overflow: 'auto',
            padding: 6,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2 }}>
            {options
              .filter((o) => !tags.includes(o))
              .map((o) => (
                <button
                  key={o}
                  onClick={() => onChange([...tags, o])}
                  className="mono"
                  style={{
                    padding: '5px 8px',
                    fontSize: 11.5,
                    background: 'transparent',
                    borderRadius: 3,
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                  }}
                >
                  {o}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
