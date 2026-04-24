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
  grail?: string;
  notes?: string;
  shipping_notes?: string;
  allowed_states?: string[];
  profile?: string;
  enabled?: boolean;
}

interface UserProfile {
  location?: string;
}

interface ConfigShape {
  user?: UserProfile;
  references: PriceReference[];
}

type Kind = 'exact' | 'hunt' | 'general_review';
type Tab = 'config' | 'queries' | 'raw';

const KIND_META: Record<Kind, { label: string; short: string; desc: string }> = {
  exact: {
    label: 'Exact item',
    short: 'Exact',
    desc: 'A specific product with known MSRP and fair/deal/steal price tiers.',
  },
  hunt: {
    label: 'Category hunt',
    short: 'Hunt',
    desc: 'A buyer profile — LLM evaluates each listing against its own typical used value.',
  },
  general_review: {
    label: 'General review',
    short: 'Review',
    desc: 'Broad "what\'s interesting on this source" scan. One per source, maximum.',
  },
};

function detectKind(ref: PriceReference): Kind {
  if (ref.type === 'general_review') return 'general_review';
  if (ref.profile) return 'hunt';
  return 'exact';
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
  const [newModalOpen, setNewModalOpen] = useState(false);

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

  const createTarget = (kind: Kind, name: string, firstSite?: string) => {
    if (!config) return;
    const id = slugify(name) || `new-${Date.now().toString(36)}`;
    const base: PriceReference = {
      id,
      name,
      type:
        kind === 'exact' ? 'item' : kind === 'hunt' ? 'category_hunt' : 'general_review',
      sites: firstSite ? [firstSite] : kind === 'general_review' ? [] : ['hifishark'],
      query: '',
    };
    if (kind === 'hunt') base.profile = '';
    if (kind === 'general_review') base.profile = '';
    setConfig({ ...config, references: [...config.references, base] });
    setSelectedId(id);
    setDirty(true);
    setNewModalOpen(false);
  };

  /**
   * Adopt an LLM-generated target into the in-memory config. The generator
   * returns a YAML string; we parse it and merge into the references list.
   * Same dirty-flag + select-the-new-row UX as createTarget.
   */
  const adoptGeneratedTarget = (parsed: Partial<PriceReference>) => {
    if (!config) return;
    const id = parsed.id?.trim() || slugify(parsed.name ?? '') || `gen-${Date.now().toString(36)}`;
    const ref: PriceReference = {
      id,
      name: parsed.name ?? 'Generated target',
      type: parsed.type ?? (parsed.profile ? 'category_hunt' : 'item'),
      sites: parsed.sites?.length ? parsed.sites : ['hifishark'],
      ...parsed,
    } as PriceReference;
    setConfig({ ...config, references: [...config.references, ref] });
    setSelectedId(id);
    setDirty(true);
    setNewModalOpen(false);
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

  // Which sites already have a general_review target?
  const generalReviewSites = useMemo(() => {
    if (!config) return new Set<string>();
    const out = new Set<string>();
    for (const r of config.references) {
      if (r.type === 'general_review' && r.sites && r.sites.length > 0) {
        out.add(r.sites[0]);
      }
    }
    return out;
  }, [config]);

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
          <button className="btn" onClick={() => setRawMode(!rawMode)}>
            {rawMode ? 'Form editor' : 'Raw YAML'}
          </button>
          <button className="btn btn-primary" onClick={() => setNewModalOpen(true)}>
            <Icon name="plus" size={12} /> New target
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
          {/* LEFT list */}
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
              {filtered.length === 0 && (
                <div
                  style={{
                    padding: '24px 16px',
                    color: 'var(--text-dim)',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                >
                  No targets match.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT editor */}
          <TargetEditor
            ref_={selected}
            onChange={(patch) => selected && updateRef(selected.id, patch)}
            onDuplicate={() => selected && duplicate(selected.id)}
            onDelete={() => selected && remove(selected.id)}
            generalReviewSites={generalReviewSites}
          />
        </div>
      ) : (
        <div className="empty-state">Loading…</div>
      )}

      {/* Floating save bar */}
      {dirty && (
        <FloatingSave onSave={save} onDiscard={load} />
      )}

      {/* New target modal */}
      {newModalOpen && config && (
        <NewTargetModal
          existingGeneralReviewSites={generalReviewSites}
          onCancel={() => setNewModalOpen(false)}
          onCreate={createTarget}
          onAdopt={adoptGeneratedTarget}
        />
      )}
    </>
  );
}

function FloatingSave({
  onSave,
  onDiscard,
}: {
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
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
      <span className="pip warn" style={{ width: 8, height: 8, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Unsaved changes
      </span>
      <button className="btn btn-sm" onClick={onDiscard}>
        Discard
      </button>
      <button className="btn btn-sm btn-primary" onClick={onSave}>
        <Icon name="check" size={11} /> Save
      </button>
    </div>
  );
}

type ModalStep = 'choose' | 'manual' | 'generate';

function NewTargetModal({
  existingGeneralReviewSites,
  onCancel,
  onCreate,
  onAdopt,
}: {
  existingGeneralReviewSites: Set<string>;
  onCancel: () => void;
  onCreate: (kind: Kind, name: string, firstSite?: string) => void;
  onAdopt: (parsed: Partial<PriceReference>) => void;
}) {
  const [step, setStep] = useState<ModalStep>('choose');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 10,
          padding: 24,
          width: 560,
          maxWidth: 'calc(100vw - 40px)',
        }}
      >
        {step === 'choose' && (
          <ChooseStep
            onPickManual={() => setStep('manual')}
            onPickGenerate={() => setStep('generate')}
            onCancel={onCancel}
          />
        )}
        {step === 'manual' && (
          <ManualStep
            existingGeneralReviewSites={existingGeneralReviewSites}
            onBack={() => setStep('choose')}
            onCreate={onCreate}
          />
        )}
        {step === 'generate' && (
          <GenerateStep
            onBack={() => setStep('choose')}
            onAdopt={onAdopt}
          />
        )}
      </div>
    </div>
  );
}

function ChooseStep({
  onPickManual,
  onPickGenerate,
  onCancel,
}: {
  onPickManual: () => void;
  onPickGenerate: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>New target</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        How would you like to set this up?
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onPickManual}
          style={{
            padding: '16px 18px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            cursor: 'pointer',
          }}
        >
          <Icon name="settings" size={20} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2 }}>
              Configure manually
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Pick the type and name; fill in pricing, queries, sources yourself.
            </div>
          </div>
        </button>
        <button
          onClick={onPickGenerate}
          style={{
            padding: '16px 18px',
            background:
              'color-mix(in oklab, var(--accent) 8%, var(--bg-input))',
            border: '1px solid color-mix(in oklab, var(--accent) 35%, var(--border))',
            borderRadius: 6,
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            cursor: 'pointer',
          }}
        >
          <Icon name="bell" size={20} className="" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2 }}>
              Generate from description
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Describe what you're hunting for in plain English; the LLM fills in
              the schema (sites, pricing, profile). You can edit before saving.
            </div>
          </div>
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function ManualStep({
  existingGeneralReviewSites,
  onBack,
  onCreate,
}: {
  existingGeneralReviewSites: Set<string>;
  onBack: () => void;
  onCreate: (kind: Kind, name: string, firstSite?: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('exact');
  const [name, setName] = useState('');
  const [site, setSite] = useState<string>('hifishark');
  const canCreate = name.trim().length > 0;

  const sources = Object.entries(SCRAPER_META);
  const availableSources = sources.filter(
    ([s]) => kind !== 'general_review' || !existingGeneralReviewSites.has(s),
  );
  const firstAvailable = availableSources[0]?.[0];
  const effectiveSite =
    kind === 'general_review' && !availableSources.find(([s]) => s === site)
      ? firstAvailable ?? site
      : site;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button
          className="btn btn-sm"
          onClick={onBack}
          style={{ padding: '4px 8px' }}
        >
          ←
        </button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Configure manually</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, marginLeft: 36 }}>
        Pick the kind of target and give it a name. You can change everything later.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(['exact', 'hunt', 'general_review'] as Kind[]).map((k) => {
          const meta = KIND_META[k];
          const disabled =
            k === 'general_review' && existingGeneralReviewSites.size >= sources.length;
          return (
            <button
              key={k}
              onClick={() => !disabled && setKind(k)}
              disabled={disabled}
              style={{
                padding: '12px 14px',
                background: kind === k ? 'var(--bg-raised)' : 'var(--bg-input)',
                border: `1px solid ${kind === k ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{meta.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {meta.desc}
                {disabled && ' (all sources already have one)'}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Name
        </div>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            kind === 'exact'
              ? 'e.g. W211 E500'
              : kind === 'hunt'
              ? 'e.g. End-game IEMs'
              : 'e.g. Daily mechmarket scan'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) {
              onCreate(
                kind,
                name.trim(),
                kind === 'general_review' ? effectiveSite : undefined,
              );
            }
          }}
        />
      </div>

      {kind === 'general_review' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Source
            <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 11 }}>
              — only one per source allowed
            </span>
          </div>
          <select
            className="select mono"
            value={effectiveSite}
            onChange={(e) => setSite(e.target.value)}
          >
            {availableSources.length === 0 ? (
              <option value="">(no sources available)</option>
            ) : (
              availableSources.map(([s, meta]) => (
                <option key={s} value={s}>
                  {meta.label}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={!canCreate || (kind === 'general_review' && !effectiveSite)}
          onClick={() =>
            onCreate(
              kind,
              name.trim(),
              kind === 'general_review' ? effectiveSite : undefined,
            )
          }
        >
          <Icon name="plus" size={12} /> Create
        </button>
      </div>
    </>
  );
}

function GenerateStep({
  onBack,
  onAdopt,
}: {
  onBack: () => void;
  onAdopt: (parsed: Partial<PriceReference>) => void;
}) {
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const submit = async () => {
    if (!description.trim() || generating) return;
    setError(null);
    setGenerating(true);
    setModel(null);
    try {
      const result = await api.generateTargetYaml(description.trim());
      setModel(result.model);
      let parsed: Partial<PriceReference>;
      try {
        const yamlObj = yaml.load(result.yaml);
        if (!yamlObj || typeof yamlObj !== 'object') {
          throw new Error('output was not an object');
        }
        parsed = yamlObj as Partial<PriceReference>;
      } catch (e) {
        throw new Error(`couldn't parse the model's YAML output: ${e}`);
      }
      if (!parsed.name) {
        throw new Error('generated target has no name field');
      }
      onAdopt(parsed);
    } catch (e) {
      setError(String(e));
      setGenerating(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button
          className="btn btn-sm"
          onClick={onBack}
          disabled={generating}
          style={{ padding: '4px 8px' }}
        >
          ←
        </button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Generate from description</div>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 14,
          marginLeft: 36,
        }}
      >
        Describe what you're hunting for. Include brands/models, budget,
        location preferences, anything to avoid. The more specific, the
        better the result.
      </div>

      <textarea
        className="textarea"
        autoFocus
        rows={7}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={generating}
        placeholder={`Examples:

I want used Focal Aria 906 bookshelf speakers. US-based sellers only — shipping speakers internationally is risky. Boston area for local pickup.

High-end IEMs with EST drivers, tribrid designs, under $2000 used. Brands I like: Empire Ears, Elysian, 64 Audio, Unique Melody. Not interested in budget chi-fi.`}
        style={{ fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5 }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter to submit
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      />

      {error && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginTop: 14,
        }}
      >
        {generating && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <Icon name="refresh" size={12} className="pulse" />
            Generating{model ? ` with ${model.split('/').pop()}` : '…'}
          </div>
        )}
        <button className="btn" onClick={onBack} disabled={generating}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={!description.trim() || generating}
          onClick={submit}
          title="Cmd/Ctrl + Enter"
        >
          <Icon name="play" size={12} /> {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
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
  const meta = KIND_META[kind];
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
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
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
                kind !== 'exact'
                  ? 'color-mix(in oklab, var(--accent) 14%, transparent)'
                  : 'var(--bg-raised)',
              color: kind !== 'exact' ? 'var(--accent-text)' : 'var(--text-muted)',
              borderColor:
                kind !== 'exact'
                  ? 'color-mix(in oklab, var(--accent) 30%, var(--border))'
                  : 'var(--border)',
              flexShrink: 0,
            }}
          >
            {meta.short}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {ref_.category ?? ref_.type ?? 'general'} · {(ref_.sites ?? []).length} source
          {(ref_.sites ?? []).length === 1 ? '' : 's'}
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

interface EditorProps {
  ref_: PriceReference | null;
  onChange: (patch: Partial<PriceReference>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  generalReviewSites: Set<string>;
}

function TargetEditor({
  ref_,
  onChange,
  onDuplicate,
  onDelete,
  generalReviewSites,
}: EditorProps) {
  const [tab, setTab] = useState<Tab>('config');

  if (!ref_) {
    return (
      <div
        style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
      >
        Select a target on the left to edit, or click "New target" to create one.
      </div>
    );
  }

  const kind = detectKind(ref_);
  const enabled = isEnabled(ref_);

  const setKind = (k: Kind) => {
    if (k === 'hunt') {
      onChange({
        profile: ref_.profile ?? '',
        msrp: undefined,
        fair_used: undefined,
        deal_price: undefined,
        steal_price: undefined,
        type: 'category_hunt',
      });
    } else if (k === 'general_review') {
      // Force to one site
      const firstSite = (ref_.sites ?? []).find((s) => !generalReviewSites.has(s) || s === ref_.sites?.[0]);
      onChange({
        profile: ref_.profile ?? '',
        msrp: undefined,
        fair_used: undefined,
        deal_price: undefined,
        steal_price: undefined,
        type: 'general_review',
        sites: firstSite ? [firstSite] : [],
      });
    } else {
      onChange({
        profile: undefined,
        type: ref_.type === 'category_hunt' || ref_.type === 'general_review' ? 'item' : ref_.type,
      });
    }
  };

  const toggleEnabled = () => {
    onChange({ enabled: !enabled });
  };

  const toggleSite = (site: string) => {
    if (kind === 'general_review') {
      // For general_review: clicking sets the single site. Block if already
      // taken by another general_review target.
      if (generalReviewSites.has(site) && ref_.sites?.[0] !== site) return;
      onChange({ sites: [site] });
      return;
    }
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
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {ref_.category ?? ref_.type ?? 'general'} · id:{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{ref_.id}</span>
          </div>
        </div>
        <Segmented
          options={[
            { value: 'exact' as const, label: 'Exact' },
            { value: 'hunt' as const, label: 'Hunt' },
            { value: 'general_review' as const, label: 'Review' },
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
          <ConfigTab
            ref_={ref_}
            kind={kind}
            onChange={onChange}
            toggleSite={toggleSite}
            generalReviewSites={generalReviewSites}
          />
        )}
        {tab === 'queries' && <QueriesTab ref_={ref_} onChange={onChange} />}
        {tab === 'raw' && <RawTab ref_={ref_} kind={kind} />}
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
      </div>
    </div>
  );
}

function ConfigTab({
  ref_,
  kind,
  onChange,
  toggleSite,
  generalReviewSites,
}: {
  ref_: PriceReference;
  kind: Kind;
  onChange: (patch: Partial<PriceReference>) => void;
  toggleSite: (site: string) => void;
  generalReviewSites: Set<string>;
}) {
  const sites = ref_.sites ?? [];
  const states = ref_.allowed_states ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {kind === 'exact' && (
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
      )}

      {kind === 'hunt' && (
        <section>
          <div className="section-title">
            Buyer Profile
            <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>
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

      {kind === 'general_review' && (
        <section>
          <div className="section-title">
            Review rules
            <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>
              — what kinds of finds are worth your time?
            </span>
          </div>
          <textarea
            className="textarea"
            rows={6}
            value={ref_.profile ?? ''}
            onChange={(e) => onChange({ profile: e.target.value })}
            placeholder="Free-form guidance. Examples:
- Always surface any mechanical keyboard switches under $0.50/switch
- Anything vintage Nakamichi tape deck in working condition
- Skip anything from outside the US
- Ignore speakers — only interested in amps and DACs"
          />
        </section>
      )}

      {kind === 'exact' && (
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
          />
        </section>
      )}

      {kind === 'exact' && (
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
            <div className="section-title">
              {kind === 'general_review' ? 'Source' : 'Sources to search'}
              {kind === 'general_review' && (
                <span
                  style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}
                >
                  — pick exactly one
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {Object.entries(SCRAPER_META).map(([site, meta]) => {
                const on = sites.includes(site);
                const blocked =
                  kind === 'general_review' &&
                  !on &&
                  generalReviewSites.has(site);
                return (
                  <button
                    key={site}
                    onClick={() => !blocked && toggleSite(site)}
                    disabled={blocked}
                    title={blocked ? 'Another review target already uses this source' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: on ? 'var(--bg-raised)' : 'var(--bg-input)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 4,
                      textAlign: 'left',
                      opacity: blocked ? 0.4 : 1,
                      cursor: blocked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {kind === 'general_review' ? (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 50,
                          border: '1px solid var(--border-strong)',
                          background: on ? 'var(--accent)' : 'var(--bg-input)',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        {on && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 50,
                              background: '#0b0c0f',
                            }}
                          />
                        )}
                      </span>
                    ) : (
                      <span className={`cbox ${on ? 'on' : ''}`} />
                    )}
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
        Object.keys(allOverrides).length > 0
          ? (allOverrides as Record<string, SiteOverride>)
          : undefined,
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
                  ? e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
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

function RawTab({ ref_, kind }: { ref_: PriceReference; kind: Kind }) {
  const yamlText = yaml.dump(
    {
      id: ref_.id,
      name: ref_.name,
      type:
        kind === 'hunt'
          ? 'category_hunt'
          : kind === 'general_review'
          ? 'general_review'
          : ref_.type ?? 'item',
      category: ref_.category,
      sites: ref_.sites ?? [],
      query: ref_.query,
      queries: ref_.queries,
      site_overrides: ref_.site_overrides,
      ...(kind !== 'exact'
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
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          fontWeight: 500,
          marginBottom: 7,
        }}
      >
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
          <span key={t} className="chip mono" style={{ background: 'var(--bg-raised)' }}>
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
