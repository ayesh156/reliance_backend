# Reliance — Coding Rules & AI Instructions

## Routing Rules (CRITICAL)

1. **Router type is `HashRouter`** — all URLs are `/#/path`. Never use `BrowserRouter`.
2. **Store routes are at root `/`** — child routes are relative: `shop`, `cart`, `product/:id`, `wishlist`, `categories`, `about`, `contact`.
3. **Admin routes are at `/system`** — all admin paths must be prefixed: `/system`, `/system/products`, `/system/invoices`, etc.
4. **Never use `/store/` prefix** — this was the old path structure. All `/store/*` links are broken. Always use root-relative paths.
5. **Cross-navigation:** Store → Admin = `to="/system"`. Admin → Store = `to="/"`.

### Correct path reference table

| Destination | Correct `to=` |
|---|---|
| Store home | `"/"` |
| Shop | `"/shop"` |
| Product detail | `"/product/${id}"` |
| Cart | `"/cart"` |
| Wishlist | `"/wishlist"` |
| Categories | `"/categories"` |
| About | `"/about"` |
| Contact | `"/contact"` |
| Admin dashboard | `"/system"` |
| Admin products | `"/system/products"` |
| Admin invoices | `"/system/invoices"` |

---

## Component Rules

### Styling
- **Pure Tailwind CSS only** — no CSS modules, no inline `style={}` except for dynamic values (e.g., color swatches)
- **No `rounded-*` on ecommerce UI elements** — sharp edges are the design language (fashion-house aesthetic)
- **Admin UI uses `rounded-xl`** — the admin panel has a softer, dashboard-style aesthetic
- Dark mode via `useTheme()` — always check `const dark = theme === 'dark'` and apply conditional classes

### Typography
- **Display/headings:** `font-display` (Playfair Display) — use for section headings and editorial text
- **Body:** `font-sans` (Inter) — use for all body copy, labels, buttons
- **Heading pattern:** italic light line + bold line (e.g., `font-light italic` + `font-bold`)
- **Eyebrow labels:** `text-[10px] uppercase tracking-[0.22em]` with a `h-px w-8` line prefix

### Icons
- **Library:** `lucide-react` only
- **Stroke width:** `strokeWidth={1.25}` for decorative/large icons, default (2) for UI icons
- **Size:** `w-4 h-4` for inline, `w-5 h-5` for nav, `w-6 h-6` for feature icons

---

## State Management Rules

- **Cart state** lives in `CartContext` — use `useCart()` hook
- **Wishlist state** lives in `WishlistContext` — use `useWishlist()` hook
- **QuickAdd drawer** is controlled via `openQuickAdd(product)` / `closeQuickAdd()` from `CartContext`
- **Never** manage cart or wishlist state locally in a component
- **localStorage keys:** `reliance-cart`, `reliance-wishlist` — do not change these

---

## File & Import Rules

- **Section components** go in `src/components/sections/`
- **Reusable UI primitives** go in `src/components/ui/`
- **Ecommerce layout** is `src/components/ecommerce/EcommerceLayout.tsx`
- **Admin layout** is `src/components/Layout.tsx`
- **Path alias `@`** maps to `src/` — use `@/components/...` for new files
- **Relative imports** are acceptable within the same feature folder

---

## AI Instructions

When working on this project:

1. **Always read the relevant file before editing** — never assume current content
2. **Check WORKSPACE.md** for known issues before starting a task
3. **Run `getDiagnostics` after every file edit** — fix all errors before presenting results
4. **Do not introduce new dependencies** without explicit user approval
5. **Do not add `rounded-*` classes** to ecommerce store components
6. **Do not use `/store/` prefix** in any `to=` or `navigate()` call — see routing table above
7. **Do not create CSS files** — all styling is Tailwind utility classes in TSX
8. **Preserve dark mode support** — every new component must handle both `dark` and light variants
9. **Keep `mockData.ts` unchanged** unless explicitly asked — it is the single source of truth for all data
10. **Admin pages use `navigate('/system/...')` not `navigate('/...')`** for internal navigation
