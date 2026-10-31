# FreightFlow — Design Guidelines (v3)

Derived from research of Samsara, Onfleet, Flexport, Linear, Stripe Dashboard and the Carbon, Polaris and Primer design systems.
Principle: **icons are functional, monochrome and inherit text colour; numbers and statuses carry the colour.**

## 1. Icons
- Library: **Lucide** via CDN, pinned (`https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js`), `<i data-lucide="truck"></i>` + `lucide.createIcons()` after every render. Bootstrap Icons are removed.
- Size grid: 16px in 14px text (tables, buttons, inline meta), 20px in sidebar and page headers. Nothing else.
- Stroke 1.75: `.lucide { stroke-width: 1.75; width: 1em; height: 1em; }`. Colour always `currentColor`; supporting icons are muted.
- **Use icons in:** sidebar items; icon-only row actions (with `aria-label` + tooltip); inline row metadata (muted 14px before plate/warehouse); empty states (one 32–40px muted icon); search field.
- **No icons in:** KPI cards, text buttons (only exception: one `plus` on the primary create button), table headers, form labels, status badges.

## 2. Logo
Plain wordmark "FreightFlow", UI font, weight 600, letter-spacing -0.01em, text colour. Optional flat single-colour 20px glyph in the accent (chevron/arrow or "FF"). No gradient, no tile, no shadow, no truck.

## 3. Components
- **KPI card:** muted 12–13px label → 28px number (weight 600, `tabular-nums`) → optional delta line ("▲ 4.2% vs previous 7 days") coloured by meaning (good/bad), not direction → optional 24–32px sparkline. Surface background, 1px border, no shadow, no icon.
- **Status pill:** 12px / 500, subtle tinted background + same-hue text, optional 6px dot.
  New → neutral grey · In Transit / On Trip → blue (accent) · Delivered / Available → green · Maintenance → amber · Cancelled → muted grey (not red). Red is reserved for overdue/late.
- **Tables:** ~44px rows, horizontal dividers only, no zebra; headers 12px muted medium/uppercase; numbers right-aligned tabular; IDs monospace; row actions muted, revealed on hover or in a `more-horizontal` menu.
- **Sidebar:** neutral background, no gradient; 20px muted icons + 14px labels; active = subtle grey fill + accent text (or 2px left bar); grouped under small uppercase section titles (Operations, Fleet, Admin).
- **Charts (Chart.js):** donut or horizontal bar using status colours; thin gridlines in border colour; no chart borders; `tension: 0.3`; legend top or hidden; max 4–5 colours per chart.

## 4. Template clichés to avoid
Pastel rounded square behind icons · gradient logo tile · icon on every button · rainbow KPI cards · big shadows and radius ≥ 16px · gradient headers/hero banners · emoji or exclamation copy · a unique hue per status.

## 5. Tokens (Bootstrap 5.3 variables)
```css
:root,[data-bs-theme=light]{
 --bs-font-sans-serif:"Inter",system-ui,sans-serif; --bs-body-font-size:.875rem;
 --bs-body-bg:#f7f7f8; --bs-body-color:#18181b; --bs-secondary-color:#71717a;
 --bs-tertiary-bg:#f1f1f3; --bs-border-color:#e4e4e7; --ff-surface:#fff;
 --bs-primary:#2563eb; --bs-primary-rgb:37,99,235; --bs-link-color:#2563eb;
 --bs-success:#15803d; --bs-warning:#b45309; --bs-danger:#b91c1c; --bs-info:#2563eb;
 --bs-success-bg-subtle:#dcfce7; --bs-warning-bg-subtle:#fef3c7;
 --bs-danger-bg-subtle:#fee2e2; --bs-primary-bg-subtle:#dbeafe;
 --bs-border-radius:.375rem; --bs-border-radius-lg:.5rem; --bs-border-radius-pill:999px;
 --bs-box-shadow-sm:none; /* spacing scale 4/8/12/16/24/32 */
}
[data-bs-theme=dark]{
 --bs-body-bg:#0f0f11; --bs-body-color:#e4e4e7; --bs-secondary-color:#a1a1aa;
 --bs-tertiary-bg:#1c1c1f; --bs-border-color:#27272a; --ff-surface:#161618;
 --bs-primary:#3b82f6; --bs-primary-rgb:59,130,246;
 --bs-success:#4ade80; --bs-warning:#fbbf24; --bs-danger:#f87171;
 --bs-success-bg-subtle:#052e16; --bs-warning-bg-subtle:#3a2a05;
 --bs-danger-bg-subtle:#3b0a0a; --bs-primary-bg-subtle:#0b1f45;
}
```
Font: Inter 400/500/600 (Google Fonts). Blue is the single accent.

Sources: Carbon icon usage, Polaris "Using icons", Primer StateLabel, Lucide docs, saasui.design KPI card patterns.
