# Notes for contributors

1. All existing tests must pass. You can most of them locally via `npm run all` or just by installing [pre-commit](https://pre-commit.com/#install) and run `pre-commit run --all-files`
2. If you add new functionality, please add test cases that will cover positive and negative scenarios. You can find them in:
    * [`__tests__`](/__tests__/main.test.ts)
    * [.github/workflows/test.yml](/.github/workflows/test.yml)
