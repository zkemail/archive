# CLAUDE.md - AI Assistant Guide

## 🎯 Project: Archive

**DKIM email archive & search engine** - Next.js 15 app for discovering and verifying email authentication keys.

## 🚀 Quick Start

```bash
pnpm run dev     # Start development (auto-runs lint & prettier)
pnpm run build   # Production build
pnpm run lint --fix  # Fix code issues
```

## 📁 Key Paths

```
/src/app/        → Pages & API routes (App Router)
/src/components/ → React components
  /ui/          → 23+ shadcn/ui components
/src/contexts/   → Global state (Auth, Toast)
/src/hooks/      → Custom hooks (useGoogleAuth, useGmailClient)
/src/lib/        → Utils & API integration
```

## 🔧 Tech Stack

- **Next.js 15.3.2** + React 19 + TypeScript (strict)
- **Tailwind CSS v4** + shadcn/ui components
- **Google OAuth** for Gmail integration
- **@zk-email/relayer-utils** for DKIM processing

## 📝 Critical Rules

### Component Development

```typescript
'use client'; // Required for ALL interactive components
import { Button } from '@/components/ui/button'; // Use @ alias
```

### Styling

```tsx
// Always use cn() for className merging
import { cn } from "@/lib/utils"
className={cn("base-class", conditional && "extra-class")}
```

### File Creation

- Interactive pages → Add `'use client'` directive
- New components → Follow existing `/components` structure
- API routes → Place in `/app/api/` directory

## 🔄 Key Workflows

### Gmail Integration Flow

1. User clicks "Connect Gmail" → GoogleAuthProvider
2. OAuth redirect → Token stored (state + localStorage)
3. Access via `useGoogleAuth()` hook
4. Gmail API calls with access token

### Email Processing

1. Upload (Gmail/file) → EmailUploader component
2. Extract DKIM headers → Parse signatures
3. Send to relayer API → Display in ProcessedLogs

## 🎨 UI Patterns

- **Theme**: NextThemes provider + ThemeToggle component
- **Toasts**: react-toastify via ToastProvider
- **Forms**: shadcn/ui components + React Hook Form
- **Responsive**: Use Tailwind breakpoints (sm: md: lg:)

## ⚠️ Common Pitfalls

1. **Missing 'use client'** → Page won't be interactive
2. **Wrong imports** → Use @/ alias, not relative paths
3. **Direct DOM manipulation** → Use React state instead
4. **Inline styles** → Use Tailwind classes
5. **localStorage in SSR** → Check `typeof window !== 'undefined'`

## 🔗 External Services

- **Gmail API**: `https://www.googleapis.com/gmail/v1/`
- **Archive API**: `https://archive.prove.email/api`
- **Relayer API**: GCP Cloud Functions for DKIM processing

## 💡 Best Practices

1. **TypeScript**: Define interfaces for ALL props/API responses
2. **State**: Context for global, useState for local
3. **Performance**: Use useDebounce for search inputs
4. **Security**: Never expose sensitive keys client-side
5. **Testing**: Check console for errors before committing

## 📊 Data Flow Examples

### Search

```
Homepage input → /search?q=domain → SearchAndFilterSection → SelectorDetails
```

### Contribute

```
/contribute → EmailUploader → OAuth/Upload → Relayer API → ProcessedLogs
```

## 🛠️ When Adding Features

### New Page

1. Create `/app/[route]/page.tsx`
2. Add `'use client'` if interactive
3. Import components from `@/components`
4. Use existing layouts/patterns

### New Component

1. Place in `/components/` (or `/components/ui/` for primitives)
2. Export from index if needed
3. Add TypeScript interfaces
4. Use Tailwind for styling

### API Integration

1. Add functions to `/lib/` directory
2. Type all responses
3. Handle errors gracefully
4. Use environment variables for endpoints

## 🚨 Priority Focus Areas

- **Performance**: Keep bundle size minimal
- **Type Safety**: No `any` types
- **Accessibility**: Use semantic HTML, ARIA labels
- **Mobile First**: Test responsive design
- **Error Handling**: User-friendly error messages

---

_Remember: Use `pnpm` (not npm/yarn), enable Turbopack for speed, and let pre-commit hooks ensure quality._
