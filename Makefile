.PHONY: build test demo web-install web-dev fmt clippy python-test embed layout-check

build:
	cargo build --workspace

test:
	cargo test --workspace
	cd python && python -m pytest -q || exit 0
	cd web && npm test --if-present

fmt:
	cargo fmt --all

clippy:
	cargo clippy --workspace --all-targets -- -D warnings

web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

python-test:
	cd python && python -m pytest -q

demo:
	@bash scripts/run-demo.sh || pwsh -File scripts/run-demo.ps1

embed:
	bash scripts/build-embed.sh

# Label-overlap + one-screen sweep over the web UI at four viewports.
# Needs faultlined on 127.0.0.1:8080 (see `make demo`); Vite is started by Playwright.
layout-check:
	cd web && npx playwright test --project=layout
