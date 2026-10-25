import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-xl border border-line bg-panel shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-white hover:brightness-110",
        variant === "secondary" && "border border-line bg-panel-2 text-fg hover:border-muted/60",
        variant === "ghost" && "text-fg-2 hover:bg-panel-2 hover:text-fg",
        variant === "danger" && "border border-neg/40 text-neg hover:bg-neg-soft",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Field({ label, help, children, className }: { label: ReactNode; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-fg-2">
        {label}
        {help && <InfoTip text={help} />}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-sm text-fg outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputCls, className)} {...rest} />;
}

export function NumberInput({
  value,
  onChange,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      className={clsx(inputCls, "tabular", className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputCls, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-2 select-none">
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {help && <InfoTip text={help} />}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-xs",
            value === o.value ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            value === t.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className, title }: { tone?: "neutral" | "ok" | "warn" | "bad" | "accent"; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-panel-2 text-fg-2 ring-1 ring-line",
        tone === "ok" && "bg-ok-soft text-pos",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-neg-soft text-neg",
        tone === "accent" && "bg-accent-soft text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function InfoTip({ text }: { text: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={id}
        className="text-muted hover:text-fg focus-visible:text-fg"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.preventDefault()}
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed font-normal text-fg-2 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-panel-2", className)} />;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "ok"; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "error" ? XCircle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div
      className={clsx(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        tone === "info" && "border-accent/30 bg-accent-soft text-fg-2",
        tone === "warn" && "border-warn/30 bg-warn-soft text-fg-2",
        tone === "error" && "border-neg/30 bg-neg-soft text-fg-2",
        tone === "ok" && "border-pos/30 bg-ok-soft text-fg-2",
      )}
    >
      <Icon
        className={clsx(
          "mt-0.5 size-4 shrink-0",
          tone === "info" && "text-accent",
          tone === "warn" && "text-warn",
          tone === "error" && "text-neg",
          tone === "ok" && "text-pos",
        )}
      />
      <div className="min-w-0">
        {title && <div className="font-medium text-fg">{title}</div>}
        {children && <div className={clsx(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <div className="text-sm font-semibold text-fg">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3.5">
        {icon && <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>}
        <div className="min-w-0">
          {eyebrow && <div className="mb-0.5 text-[11px] font-semibold tracking-wider text-accent uppercase">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, icon, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4 shadow-card">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className={clsx("mt-2 text-2xl font-semibold tracking-tight", tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-fg")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function SampleBadge({ inSample, heldOutStart }: { inSample: boolean; heldOutStart: string | null }) {
  if (!heldOutStart) return <Badge tone="neutral" title="No ML model involved, so there is no training window to overlap.">No model window</Badge>;
  return inSample ? (
    <Badge tone="bad" title={`Window starts before the model's held-out period (${heldOutStart.slice(0, 10)}).`}>
      <AlertTriangle className="size-3" /> In-sample
    </Badge>
  ) : (
    <Badge tone="ok" title={`Every bar is after the model's held-out start (${heldOutStart.slice(0, 10)}).`}>
      <CheckCircle2 className="size-3" /> Held-out
    </Badge>
  );
}
