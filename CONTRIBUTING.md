# Contributing to Mneme

Thank you for your interest in contributing to Mneme! 🧠

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- npm or pnpm
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mneme.git
cd mneme

# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run dev
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch** for your feature/fix: `git checkout -b feat/your-feature`
3. **Make changes** and write tests
4. **Run tests**: `npm test`
5. **Lint**: `npm run lint:fix`
6. **Format**: `npm run format`
7. **Commit** with clear message: `git commit -m "feat: add new adapter"`
8. **Push** to your fork: `git push origin feat/your-feature`
9. **Open a Pull Request**

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Test changes
- `refactor:` Code refactoring
- `chore:` Build/tooling changes

Examples:
```
feat: add Google Chat adapter
fix: handle duplicate messages in ingestion
docs: update API documentation
test: add integration tests for retrieval
```

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- No `any` types (use `unknown` if needed)
- Prefer `async/await` over callbacks
- Write tests for new features

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

## Project Structure

```
src/
├── adapters/      # Source adapters (Google Chat, Slack, etc.)
├── api/           # REST API endpoints
├── core/          # Core services (Ingestion, Storage, Retrieval)
├── storage/       # Database layer
├── types/         # TypeScript types
└── utils/         # Utility functions
```

## Adding a New Adapter

1. Create `src/adapters/your-source.ts`
2. Implement `SourceAdapter` interface
3. Export from `src/adapters/index.ts`
4. Add tests in `src/adapters/your-source.test.ts`
5. Update documentation

Example:
```typescript
import { SourceAdapter, Message } from '../types';

export class YourSourceAdapter implements SourceAdapter {
  id = 'your-source';
  type = 'webhook' as const;

  async start() {
    // Setup webhook, polling, etc.
  }

  async stop() {
    // Cleanup
  }

  onMessage(callback: (msg: Message) => void) {
    // Handle incoming messages
  }
}
```

## Documentation

- Update `README.md` for user-facing changes
- Update `docs/` for design/architecture changes
- Add JSDoc comments for public APIs

## Pull Request Guidelines

- Keep PRs focused (one feature/fix per PR)
- Include tests
- Update documentation
- Ensure CI passes
- Reference related issues

## Questions?

- Open an [issue](https://github.com/mneme/mneme/issues)
- Join our [Discord](https://discord.gg/mneme) (coming soon)

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build something great together.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
