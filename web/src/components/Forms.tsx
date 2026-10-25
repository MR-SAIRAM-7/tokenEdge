import { useState } from "react";
import { usePresets } from "../api/queries";
import type { ExecutionIn, JsonSchemaProp, ModelSummary, StrategyInfo, WindowName } from "../api/types";
import { Checkbox, Field, Input, NumberInput, Segmented, Select } from "./ui";

// ------------------------------------------------------------------ strategy params

/** Models a strategy can use: its own model type, or any model for strategies such as the ML filter. */
export const usableModels = (strategy: StrategyInfo | undefined, models: ModelSummary[]) =>
  strategy?.kind === "ml" ? models.filter((m) => !strategy.model_type || m.model_type === strategy.model_type) : [];

const optionLabel = (o: string) => (o.length <= 4 ? o.toUpperCase() : (o.charAt(0).toUpperCase() + o.slice(1)).replace("_", "-"));

function propType(p: JsonSchemaProp): { type: string; enum?: string[] } {
  if (p.enum) return { type: "enum", enum: p.enum };
  if (p.type) return { type: p.type };
  const inner = p.anyOf?.find((x) => x.type && x.type !== "null");
  return { type: inner?.type ?? "string", enum: inner?.enum };
}

function propBounds(p: JsonSchemaProp) {
  const inner = p.anyOf?.find((x) => x.type && x.type !== "null");
  return { min: p.minimum ?? inner?.minimum, max: p.maximum ?? inner?.maximum };
}

export function StrategyParamsForm({
  strategy,
  params,
  onChange,
  models,
}: {
  strategy: StrategyInfo;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  models: ModelSummary[];
}) {
  const props = strategy.params_schema.properties ?? {};
  const keys = Object.keys(props);
  if (!keys.length) return <p className="text-xs text-muted">This strategy has no parameters.</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {keys.map((key) => {
        const p = props[key];
        const { type, enum: options } = propType(p);
        const label = p.title ?? key;
        if (key === "model_id") {
          const usable = usableModels(strategy, models);
          return (
            <Field key={key} label={label} help={p.description} className="col-span-2">
              <Select value={(params[key] as string) ?? ""} onChange={(e) => onChange({ ...params, [key]: e.target.value })}>
                <option value="" disabled>
                  {usable.length ? "Select a model…" : "No trained models yet"}
                </option>
                {usable.map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.model_id} ({m.symbol} {m.interval}{strategy.model_type ? "" : `, ${m.model_type}`})
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (type === "enum" && options) {
          return (
            <Field key={key} label={label} help={p.description}>
              <Select value={(params[key] as string) ?? (p.default as string)} onChange={(e) => onChange({ ...params, [key]: e.target.value })}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {optionLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (type === "integer" || type === "number") {
          const { min, max } = propBounds(p);
          const v = key in params ? (params[key] as number | null) : (p.default as number | null | undefined) ?? null;
          return (
            <Field key={key} label={label} help={p.description}>
              <NumberInput
                value={v}
                min={min}
                max={max}
                step={type === "integer" ? 1 : 0.01}
                placeholder={p.default == null ? "auto" : String(p.default)}
                onChange={(x) => {
                  const next = { ...params };
                  if (x === null) delete next[key];
                  else next[key] = type === "integer" ? Math.round(x) : x;
                  onChange(next);
                }}
              />
            </Field>
          );
        }
        return (
          <Field key={key} label={label} help={p.description}>
            <Input value={(params[key] as string) ?? ""} onChange={(e) => onChange({ ...params, [key]: e.target.value })} />
          </Field>
        );
      })}
    </div>
  );
}

export function defaultParams(strategy: StrategyInfo, models: ModelSummary[], symbol: string, interval: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(strategy.params_schema.properties ?? {})) {
    if (k === "model_id") {
      const usable = usableModels(strategy, models);
      const match = usable.find((m) => m.symbol === symbol && m.interval === interval) ?? usable[0];
      if (match) out[k] = match.model_id;
    } else if (p.default !== undefined && p.default !== null) {
      out[k] = p.default;
    }
  }
  return out;
}

// ------------------------------------------------------------------ window

export function WindowPicker({
  value,
  onChange,
  start,
  end,
  onDates,
  hasModel,
}: {
  value: WindowName;
  onChange: (w: WindowName) => void;
  start: string;
  end: string;
  onDates: (start: string, end: string) => void;
  hasModel: boolean;
}) {
  return (
    <div className="space-y-2">
      <Segmented<WindowName>
        value={value}
        onChange={onChange}
        size="sm"
        options={[
          { value: "train", label: "Train", title: "Default training window (in-sample for any model)" },
          { value: "val", label: "Validation", title: "Default validation window" },
          { value: "test", label: "Test", title: "Default held-out test window" },
          { value: "model_test", label: "Model test", disabled: !hasModel, title: "Held-out window of the selected model(s)" },
          { value: "full", label: "Full" },
          { value: "custom", label: "Custom" },
        ]}
      />
      {value === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start">
            <Input type="date" value={start} onChange={(e) => onDates(e.target.value, end)} />
          </Field>
          <Field label="End">
            <Input type="date" value={end} onChange={(e) => onDates(start, e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ execution

export const DEFAULT_EXECUTION: ExecutionIn = {
  preset: null,
  initial_capital: 100_000,
  mode: "long_flat",
  max_leverage: 1,
  borrow_rate: 0,
};

export function ExecutionPanel({ value, onChange, advancedOpen = false }: { value: ExecutionIn; onChange: (v: ExecutionIn) => void; advancedOpen?: boolean }) {
  const { data: presets } = usePresets();
  const [advanced, setAdvanced] = useState(advancedOpen);
  const preset = presets?.find((p) => p.name === value.preset);

  // Custom costs start from the chosen preset so users edit numbers rather than start from zero.
  const commission = value.commission ?? { buy_bps: preset?.commission.buy_bps ?? 0, sell_bps: preset?.commission.sell_bps ?? 0, fixed_fee: 0, min_fee: 0 };
  const slippage = value.slippage ?? {
    model: (preset?.slippage.model as "fixed") ?? "fixed",
    bps: preset?.slippage.bps ?? 0,
    range_fraction: 0.1,
    half_spread_bps: 1,
    impact_coef: 0.1,
  };
  const custom = !!(value.commission || value.slippage);

  return (
    <div className="space-y-3">
      <Field label="Cost preset" help="Commission and slippage assumptions. 'Auto' picks one from the market (US, NSE or crypto).">
        <Select
          value={custom ? "__custom" : value.preset ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom") onChange({ ...value, commission, slippage });
            else onChange({ ...value, preset: v || null, commission: null, slippage: null, fractional: null });
          }}
        >
          <option value="">Auto (by market)</option>
          {presets?.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
          <option value="__custom">Custom…</option>
        </Select>
      </Field>
      {preset && !custom && <p className="-mt-1 text-xs text-muted">{preset.description}</p>}

      {custom && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3">
          <Field label="Buy commission (bps)">
            <NumberInput value={commission.buy_bps} min={0} step={0.5} onChange={(x) => onChange({ ...value, commission: { ...commission, buy_bps: x ?? 0 }, slippage })} />
          </Field>
          <Field label="Sell commission (bps)">
            <NumberInput value={commission.sell_bps} min={0} step={0.5} onChange={(x) => onChange({ ...value, commission: { ...commission, sell_bps: x ?? 0 }, slippage })} />
          </Field>
          <Field label="Slippage model" help="Fixed bps; a fraction of the previous bar's range; or square-root market impact based on trade size vs average volume." className="col-span-2">
            <Select value={slippage.model} onChange={(e) => onChange({ ...value, commission, slippage: { ...slippage, model: e.target.value as "fixed" } })}>
              <option value="fixed">Fixed (bps)</option>
              <option value="range">Range-based (fraction of H−L)</option>
              <option value="sqrt_impact">Square-root impact</option>
            </Select>
          </Field>
          {slippage.model === "fixed" && (
            <Field label="Slippage (bps)">
              <NumberInput value={slippage.bps} min={0} step={0.5} onChange={(x) => onChange({ ...value, commission, slippage: { ...slippage, bps: x ?? 0 } })} />
            </Field>
          )}
          {slippage.model === "range" && (
            <Field label="Range fraction">
              <NumberInput value={slippage.range_fraction} min={0} max={1} step={0.01} onChange={(x) => onChange({ ...value, commission, slippage: { ...slippage, range_fraction: x ?? 0 } })} />
            </Field>
          )}
          {slippage.model === "sqrt_impact" && (
            <>
              <Field label="Half spread (bps)">
                <NumberInput value={slippage.half_spread_bps} min={0} step={0.5} onChange={(x) => onChange({ ...value, commission, slippage: { ...slippage, half_spread_bps: x ?? 0 } })} />
              </Field>
              <Field label="Impact coefficient η">
                <NumberInput value={slippage.impact_coef} min={0} step={0.05} onChange={(x) => onChange({ ...value, commission, slippage: { ...slippage, impact_coef: x ?? 0 } })} />
              </Field>
            </>
          )}
        </div>
      )}

      <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? "Hide" : "Show"} advanced execution settings
      </button>
      {advanced && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Initial capital">
            <NumberInput value={value.initial_capital} min={1} step={1000} onChange={(x) => onChange({ ...value, initial_capital: x ?? 100000 })} />
          </Field>
          <Field label="Max leverage" help="Position value as a multiple of equity when fully invested.">
            <NumberInput value={value.max_leverage} min={0.1} max={5} step={0.1} onChange={(x) => onChange({ ...value, max_leverage: x ?? 1 })} />
          </Field>
          <Field label="Mode" help="Long/flat never shorts. Long/short goes short when the strategy is bearish." className="col-span-2">
            <Segmented
              value={value.mode}
              onChange={(m) => onChange({ ...value, mode: m })}
              options={[
                { value: "long_flat", label: "Long / flat" },
                { value: "long_short", label: "Long / short" },
              ]}
            />
          </Field>
          <Field label="Interest on idle cash" help="Annual rate earned on cash not in a position, e.g. 0.04 = 4%. Empty = the 4% risk-free rate the Sharpe ratio subtracts, so a strategy that stays flat scores about zero.">
            <NumberInput value={value.cash_rate ?? null} min={0} max={1} step={0.005} placeholder="0.04 (risk-free)" onChange={(x) => onChange({ ...value, cash_rate: x })} />
          </Field>
          {value.mode === "long_short" && (
            <Field label="Borrow rate (annual)" help="Cost of borrowing for short positions, e.g. 0.02 = 2% per year.">
              <NumberInput value={value.borrow_rate} min={0} max={1} step={0.005} onChange={(x) => onChange({ ...value, borrow_rate: x ?? 0 })} />
            </Field>
          )}
          <div className="col-span-2">
            <Checkbox
              checked={value.fractional ?? preset?.fractional ?? false}
              onChange={(v) => onChange({ ...value, fractional: v })}
              label="Fractional quantities"
              help="Off = whole shares only (equities). Crypto presets allow fractions by default."
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function cleanExecution(e: ExecutionIn): ExecutionIn {
  const out: ExecutionIn = { ...e };
  if (!out.preset) delete out.preset;
  if (!out.commission) delete out.commission;
  if (!out.slippage) delete out.slippage;
  if (out.fractional === null || out.fractional === undefined) delete out.fractional;
  if (out.cash_rate === null || out.cash_rate === undefined) delete out.cash_rate;
  return out;
}
