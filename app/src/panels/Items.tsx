import { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { api } from '../api';
import { SCRAPER_META } from '../types';

interface Variant {
  model: string;
  msrp?: number;
  fair_used?: number;
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
  year_range?: [number, number];
  engine?: string;
  max_mileage?: number;
  variants?: Variant[];
  grail?: string;
  notes?: string;
  shipping_notes?: string;
  allowed_states?: string[];
  profile?: string;
}

interface UserProfile {
  location?: string;
}

interface ConfigShape {
  user?: UserProfile;
  references: PriceReference[];
}

type ItemType = 'exact' | 'category_hunt';

function detectType(ref: PriceReference): ItemType {
  return ref.profile ? 'category_hunt' : 'exact';
}

export function Items() {
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [rawYaml, setRawYaml] = useState<string>('');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    try {
      const content = await api.readConfig();
      setRawYaml(content);
      try {
        const parsed = yaml.load(content) as ConfigShape;
        if (!parsed.references) parsed.references = [];
        setConfig(parsed);
        setParseError(null);
      } catch (e) {
        setParseError(String(e));
        setConfig(null);
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
      if (showRaw) {
        // validate raw YAML first
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
      setSaveMsg('Config saved.');
      setTimeout(() => setSaveMsg(null), 3000);
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

  const addNew = (type: ItemType) => {
    if (!config) return;
    const id = `new-${Date.now().toString(36)}`;
    const base: PriceReference = {
      id,
      name: 'New item',
      type: type === 'exact' ? 'item' : 'category_hunt',
      sites: ['hifishark'],
      query: '',
    };
    if (type === 'category_hunt') base.profile = '';
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
    if (!confirm(`Delete item "${id}"?`)) return;
    setConfig({ ...config, references: config.references.filter((r) => r.id !== id) });
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  };

  const selected = config?.references.find((r) => r.id === selectedId);

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Items</h2>
          <div className="subtitle">
            {config
              ? `${config.references.length} item${config.references.length === 1 ? '' : 's'}`
              : '…'}
          </div>
        </div>
        <div className="panel-header-actions">
          <button className="btn sm" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? 'Form editor' : 'Raw YAML'}
          </button>
          <button className="btn sm" onClick={load}>Reload</button>
          <button
            className="btn sm primary"
            onClick={save}
            disabled={!dirty && !showRaw}
          >
            Save
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {parseError && <div className="error-banner">YAML parse error: {parseError}</div>}
      {saveMsg && (
        <div
          className="error-banner"
          style={{ background: 'var(--success-bg)', color: '#d1fae5' }}
        >
          {saveMsg}
        </div>
      )}

      {showRaw ? (
        <div className="card">
          <h3>Raw YAML</h3>
          <textarea
            value={rawYaml}
            onChange={(e) => {
              setRawYaml(e.target.value);
              setDirty(true);
            }}
            style={{ minHeight: '60vh', fontFamily: 'var(--mono)', fontSize: 12 }}
          />
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            Edits save directly to config/price-reference.yaml.
          </div>
        </div>
      ) : config ? (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => addNew('exact')}>+ Exact</button>
              <button className="btn sm" onClick={() => addNew('category_hunt')}>+ Hunt</button>
            </div>
            {config.references.map((ref) => {
              const itemType = detectType(ref);
              return (
                <div
                  key={ref.id}
                  className="card"
                  style={{
                    marginBottom: 0,
                    padding: 10,
                    cursor: 'pointer',
                    borderColor: selectedId === ref.id ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setSelectedId(ref.id)}
                >
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>
                    {ref.name}
                  </div>
                  <div className="faint mono" style={{ fontSize: 10 }}>
                    {ref.id}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <span className="pill" style={{ fontSize: 9 }}>
                      {itemType === 'exact' ? 'exact' : 'hunt'}
                    </span>
                    <span className="faint" style={{ fontSize: 10 }}>
                      {(ref.sites ?? []).length} site{(ref.sites ?? []).length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            {selected ? (
              <ItemEditor
                ref_={selected}
                onChange={(patch) => updateRef(selected.id, patch)}
                onDuplicate={() => duplicate(selected.id)}
                onDelete={() => remove(selected.id)}
              />
            ) : (
              <div className="card empty-state">
                Select an item on the left, or click <strong>+ Exact</strong> /{' '}
                <strong>+ Hunt</strong> to create one.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">Loading…</div>
      )}
    </div>
  );
}

interface EditorProps {
  ref_: PriceReference;
  onChange: (patch: Partial<PriceReference>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ItemEditor({ ref_, onChange, onDuplicate, onDelete }: EditorProps) {
  const [type, setType] = useState<ItemType>(detectType(ref_));
  // Keep local type in sync with selected ref
  useEffect(() => {
    setType(detectType(ref_));
  }, [ref_.id]);

  const handleTypeChange = (t: ItemType) => {
    setType(t);
    if (t === 'category_hunt') {
      // Switching to hunt: ensure profile field, clear tier fields
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
      onChange({ profile: undefined, type: ref_.type === 'category_hunt' ? 'item' : ref_.type });
    }
  };

  const sites = ref_.sites ?? [];
  const toggleSite = (site: string) => {
    const next = sites.includes(site) ? sites.filter((s) => s !== site) : [...sites, site];
    onChange({ sites: next });
  };

  return (
    <div>
      <div className="card">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 6 }}>
            <button
              className={`btn sm ${type === 'exact' ? 'primary' : ''}`}
              onClick={() => handleTypeChange('exact')}
            >
              Exact item
            </button>
            <button
              className={`btn sm ${type === 'category_hunt' ? 'primary' : ''}`}
              onClick={() => handleTypeChange('category_hunt')}
            >
              Category hunt
            </button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={onDuplicate}>Duplicate</button>
            <button className="btn sm danger" onClick={onDelete}>Delete</button>
          </div>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">ID</span>
            <input
              type="text"
              value={ref_.id}
              onChange={(e) => onChange({ id: e.target.value })}
              className="mono"
            />
          </label>
          <label className="field" style={{ flex: 2 }}>
            <span className="field-label">Name</span>
            <input
              type="text"
              value={ref_.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Type</span>
            <input
              type="text"
              value={ref_.type}
              onChange={(e) => onChange({ type: e.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Category</span>
            <input
              type="text"
              value={ref_.category ?? ''}
              onChange={(e) => onChange({ category: e.target.value || undefined })}
            />
          </label>
        </div>
      </div>

      {/* Query */}
      <div className="card">
        <h3>Search query</h3>
        <label className="field">
          <span className="field-label">Default query</span>
          <input
            type="text"
            value={ref_.query ?? ''}
            onChange={(e) => onChange({ query: e.target.value || undefined })}
            placeholder="e.g. W211 E500 or holy panda"
          />
        </label>
        <label className="field">
          <span className="field-label">Multiple queries (one per line, optional)</span>
          <textarea
            value={(ref_.queries ?? []).join('\n')}
            onChange={(e) =>
              onChange({
                queries: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean),
              })
            }
            placeholder={'query A\nquery B'}
          />
          <span className="field-help">If both are set, queries[] takes precedence.</span>
        </label>
      </div>

      {/* Sites */}
      <div className="card">
        <h3>Sites to search</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 6,
          }}
        >
          {Object.entries(SCRAPER_META).map(([site, meta]) => (
            <label key={site} className="row" style={{ gap: 8, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={sites.includes(site)}
                onChange={() => toggleSite(site)}
              />
              <span>{meta.label}</span>
              <span className="faint mono" style={{ fontSize: 10 }}>{site}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Tiers (exact) or Profile (hunt) */}
      {type === 'exact' ? (
        <div className="card">
          <h3>Price tiers (USD)</h3>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <NumField label="MSRP" value={ref_.msrp} onChange={(v) => onChange({ msrp: v })} />
            <NumField
              label="Fair used"
              value={ref_.fair_used}
              onChange={(v) => onChange({ fair_used: v })}
            />
            <NumField
              label="Deal price"
              value={ref_.deal_price}
              onChange={(v) => onChange({ deal_price: v })}
            />
            <NumField
              label="Steal price"
              value={ref_.steal_price}
              onChange={(v) => onChange({ steal_price: v })}
            />
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="field-label">Grail description (optional)</span>
            <textarea
              value={ref_.grail ?? ''}
              onChange={(e) => onChange({ grail: e.target.value || undefined })}
              placeholder="e.g. 'OEM AMG wheels, <80k miles, documented service'"
            />
          </label>
        </div>
      ) : (
        <div className="card">
          <h3>Buyer profile</h3>
          <label className="field">
            <span className="field-label">Profile (free text)</span>
            <textarea
              value={ref_.profile ?? ''}
              onChange={(e) => onChange({ profile: e.target.value })}
              style={{ minHeight: 160 }}
              placeholder="Describe what you're looking for — taste, budget, preferred brands, dealbreakers…"
            />
            <span className="field-help">
              The LLM evaluates each listing against its own used-market value, using this profile
              as the filter.
            </span>
          </label>
        </div>
      )}

      {/* Geography / shipping */}
      <div className="card">
        <h3>Geography & shipping</h3>
        <label className="field">
          <span className="field-label">Location (for Craigslist/FBMP)</span>
          <input
            type="text"
            value={ref_.location ?? ''}
            onChange={(e) => onChange({ location: e.target.value || undefined })}
            placeholder="e.g. boston"
          />
        </label>
        <label className="field">
          <span className="field-label">Allowed states (comma-separated, optional)</span>
          <input
            type="text"
            value={(ref_.allowed_states ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                allowed_states:
                  e.target.value
                    .split(',')
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean) || undefined,
              })
            }
            placeholder="MA, NH, RI, CT"
          />
          <span className="field-help">
            Pre-filters location-aware scrapers before the LLM evaluates. Saves tokens.
          </span>
        </label>
        <label className="field">
          <span className="field-label">Shipping notes</span>
          <textarea
            value={ref_.shipping_notes ?? ''}
            onChange={(e) => onChange({ shipping_notes: e.target.value || undefined })}
            placeholder="e.g. 'Local pickup only — no shipping interest'"
          />
        </label>
      </div>

      {/* Notes */}
      <div className="card">
        <h3>Notes</h3>
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Domain knowledge & reminders</span>
          <textarea
            value={ref_.notes ?? ''}
            onChange={(e) => onChange({ notes: e.target.value || undefined })}
            style={{ minHeight: 100 }}
            placeholder="What to check for, common gotchas, pricing context the LLM should know…"
          />
        </label>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 120 }}>
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
      />
    </label>
  );
}
