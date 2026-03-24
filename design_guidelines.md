# Email Generator Platform - Design Guidelines

## Design Approach
**Selected Framework:** Design System Approach (Linear + Modern SaaS Productivity Tools)  
**Rationale:** This is a utility-focused productivity application requiring efficiency, clarity, and learnability. Drawing inspiration from Linear's clean interface, Notion's content organization, and modern email marketing platforms like Mailchimp.

**Core Principles:**
- Clarity over decoration - every element serves a purpose
- Progressive disclosure - reveal complexity as needed
- Immediate feedback - users see results of actions instantly
- Data-driven decisions - analytics and metrics prominently displayed

---

## Color Palette

### Dark Mode (Primary)
- **Background:** 217 19% 12% (deep slate)
- **Surface:** 217 19% 18% (elevated cards/panels)
- **Surface Elevated:** 217 19% 22% (modals, dropdowns)
- **Border:** 217 10% 28% (subtle divisions)
- **Text Primary:** 217 10% 95% (high contrast)
- **Text Secondary:** 217 8% 70% (labels, metadata)
- **Text Tertiary:** 217 8% 50% (placeholders, disabled)

### Accent Colors
- **Primary (Brand):** 262 83% 58% (vibrant purple - CTAs, active states)
- **Success (Winning):** 142 71% 45% (green - winning emails, positive metrics)
- **Warning (Learning):** 38 92% 50% (amber - needs review, learning phase)
- **Danger (Losing):** 0 84% 60% (red - losing emails, errors)
- **Info (Analytics):** 199 89% 48% (cyan - data, insights)

### Light Mode (Secondary)
- **Background:** 0 0% 98%
- **Surface:** 0 0% 100%
- **Text Primary:** 217 19% 12%
- **Borders:** 217 10% 88%

---

## Typography

### Font Families
- **Primary (UI):** Inter via Google Fonts - modern, highly legible
- **Monospace (Email Code):** JetBrains Mono via Google Fonts - for email HTML preview

### Type Scale
- **Hero/Headers (3xl):** 30px, weight 600, tracking -0.02em
- **Section Headers (2xl):** 24px, weight 600, tracking -0.01em
- **Card Titles (xl):** 20px, weight 600
- **Body Large (lg):** 16px, weight 400, line-height 1.6
- **Body (base):** 14px, weight 400, line-height 1.5
- **Small/Labels (sm):** 13px, weight 500, line-height 1.4
- **Tiny/Metadata (xs):** 12px, weight 400, line-height 1.3

---

## Layout System

### Spacing Units (Tailwind)
**Consistent spacing primitives:** 2, 4, 6, 8, 12, 16, 24
- Micro spacing: p-2, gap-2 (8px)
- Component padding: p-4, p-6 (16-24px)
- Section spacing: py-8, py-12 (32-48px)
- Page margins: px-6 on mobile, px-12 on desktop

### Grid System
- **Three-column layout:** Sidebar (280px) | Main Content (flexible) | Insights Panel (320px)
- **Responsive:** Stack to single column on mobile (<768px)
- **Max Width:** Container max-w-7xl (1280px)

---

## Component Library

### Navigation
- **Sidebar:** Fixed left, dark surface, icon + label navigation
  - Sections: Generate, Products, Email Library, Analytics, Settings
  - Active state: Primary color highlight with subtle background
  - Collapsed mode on mobile

### Email Generator Section
- **Layout:** Two-panel split (50/50)
  - Left: Configuration panel with form inputs
  - Right: Live email preview with HTML/plaintext toggle
- **Configuration Panel:**
  - Product multi-select dropdown with checkboxes
  - Tone selector: Casual, Professional, Enthusiastic, Urgent (pill buttons)
  - Length slider: Short (100 words) → Long (400 words)
  - CTA input field for primary action
  - Generate button (primary, full-width, h-12)
- **Preview Panel:**
  - Email subject line (bold, text-lg)
  - Email body with formatted HTML rendering
  - Tab switcher: Preview | HTML Code | Plain Text
  - Action buttons: Regenerate, Edit, Save, Rate

### Product Management Section
- **Product Grid:** 3-column responsive grid (1 col mobile, 2 tablet, 3 desktop)
- **Product Card:**
  - Product image (aspect-ratio-square, rounded-lg)
  - Product name (font-semibold, text-base)
  - Price, category, status badge
  - Quick actions: Edit, Delete, Use in Email
  - Hover state: Subtle elevation (shadow-lg)
- **Add Product Button:** Floating action button (bottom-right, primary color, size-16)
- **Product Form Modal:**
  - Full-screen overlay with centered card (max-w-2xl)
  - Fields: Name, Description, Price, Category, Image URL, Tags
  - Image upload preview
  - Action buttons: Save, Cancel

### Email Library & Feedback
- **Email Card Layout:** Vertical list with dividers
  - Email subject (font-semibold)
  - Preview text (text-secondary, truncated)
  - Products featured (small product chips)
  - Metrics row: Open rate, Click rate, Generated date
  - Rating badges: 🏆 Winning (green) | 📊 Learning (amber) | ❌ Losing (red)
  - Hover actions: View Full, Re-use, Delete
- **Feedback Controls:**
  - Toggle group: Mark as Winning | Neutral | Mark as Losing
  - Performance metrics input: Open %, Click %, Conversion %
  - Notes textarea for qualitative feedback

### Analytics Dashboard
- **Card-Based Layout:** 2-column grid (1 col mobile)
- **Metric Cards:**
  - Total emails generated (large number, trend indicator)
  - Winning email rate (percentage, green highlight)
  - Most successful products (top 3 list)
  - Learning progress bar (shows AI improvement over time)
- **Charts:**
  - Line chart: Email performance over time
  - Bar chart: Product performance comparison
  - Heatmap: Best performing email characteristics
- **Insights Panel (Right Sidebar):**
  - "What's Working" highlights (bullet points, green)
  - "Try This Next" AI suggestions (amber callouts)
  - Recent winning patterns (tags/chips)

---

## Interactive Elements

### Buttons
- **Primary:** bg-primary, text-white, h-10, px-6, rounded-lg, font-medium
- **Secondary:** bg-surface-elevated, text-primary, border
- **Ghost:** hover:bg-surface, text-secondary
- **Destructive:** bg-danger, text-white

### Form Inputs
- **Text Inputs:** h-10, px-4, rounded-lg, bg-surface, border-border, focus:border-primary
- **Dropdowns:** Same styling, chevron icon right
- **Checkboxes:** accent-primary, rounded
- **Sliders:** accent-primary with value label

### Modals & Overlays
- **Backdrop:** bg-black/50, backdrop-blur-sm
- **Modal Card:** bg-surface-elevated, rounded-xl, shadow-2xl, p-6
- **Close Button:** Top-right, ghost button with X icon

### Loading States
- **Skeleton screens** for email generation (pulsing animation)
- **Spinner overlay** for product actions
- **Progress indicators** for AI learning status

---

## Images

**Hero Section:** None - this is a utility application focused on workflow efficiency

**Product Images:**
- Location: Product cards in management section
- Style: Square aspect ratio (1:1), rounded corners (rounded-lg)
- Fallback: Gradient placeholder with product initial
- Size: 200x200px displayed, responsive scaling

**Email Preview Images:**
- Location: Within generated email content
- Style: Maintain original aspect ratios, max-width: 100%
- Note: User-uploaded product images embedded in email templates

**Empty States:**
- Location: Empty product library, no emails generated yet
- Style: Simple illustration or icon (from Heroicons), centered with supportive text

---

## Animations

**Minimal & Purposeful:**
- Page transitions: None (instant navigation)
- Button hover: Subtle scale (scale-105) on primary actions only
- Email generation: Fade-in animation (duration-300) when content appears
- Card hover: Subtle lift (translate-y-1, shadow increase)
- Success feedback: Check icon fade-in after save actions

**Performance:** Use transform and opacity only, no expensive repaints

---

## Accessibility & Polish

- Maintain consistent dark mode across all inputs, modals, and overlays
- Focus states: 2px primary color outline with offset
- Keyboard navigation: Full support with visible focus indicators
- Screen reader labels on all icon-only buttons
- Color contrast: WCAG AA minimum for all text
- Error states: Red border + icon + descriptive message below input
- Success states: Green check icon + confirmation message (toast notification)