# Contributing to ZK Email Archive

Thank you for your interest in contributing to ZK Email Archive! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL database

### Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your values
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Generate Prisma client:
   ```bash
   pnpm prisma generate
   ```
5. Run migrations:
   ```bash
   pnpm prisma migrate deploy
   ```
6. Start development server:
   ```bash
   pnpm dev
   ```

## Code Style

This project uses:

- **ESLint** for linting
- **Prettier** for formatting
- **Husky** for pre-commit hooks

Run these commands before committing:

```bash
pnpm lint --fix
pnpm prettier
```

## Testing

Run tests with:

```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report
```

## Project Structure

```
src/
├── app/           # Next.js App Router pages and API routes
│   ├── api/       # API endpoints
│   └── ...        # Page components
├── components/    # React components
│   └── ui/        # shadcn/ui components
├── hooks/         # Custom React hooks
├── lib/           # Utility functions and libraries
├── types/         # TypeScript type definitions
└── contexts/      # React context providers
```

## API Development

When adding new API endpoints:

1. Create route file in `src/app/api/[endpoint]/route.ts`
2. Add rate limiting using `checkRateLimit()`
3. Use structured logger for monitoring
4. Add TypeScript types to `src/types/api.ts`
5. Write tests in `src/lib/__tests__/`

## Commit Messages

Follow conventional commits format:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions or changes
- `ci:` CI/CD changes
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes with clear commits
3. Ensure all tests pass
4. Ensure build succeeds: `pnpm build`
5. Open a PR with a clear description
