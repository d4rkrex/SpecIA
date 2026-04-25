# Contributing to SpecIA

Thank you for your interest in contributing to SpecIA!

## How to Contribute

### Reporting Issues

If you find a bug or have a feature request:
1. Check if the issue already exists in [GitHub Issues](https://github.com/d4rkrex/SpecIA/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - Your environment (OS, Node version, AI editor)

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests: `cd full && npm test`
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/d4rkrex/SpecIA.git
cd SpecIA/full
npm install
npm run build
npm test
```

### Code Style

- Follow existing code style
- Use TypeScript for new code
- Add tests for new features
- Update documentation as needed

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint
```

### Documentation

- Update README.md for user-facing changes
- Update CHANGELOG.md following existing format
- Add examples in `lite/examples/` for new features

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
