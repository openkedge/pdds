.PHONY: all install build typecheck test test-conformance test-integration demo demo-postgres demo-k8s demo-efd bench study analyze microbench clean

all: build test

install:
	pnpm install

build:
	pnpm -r run build

typecheck:
	pnpm run typecheck

test:
	pnpm test

test-conformance:
	pnpm test:conformance

test-integration:
	pnpm test:integration

demo:
	pnpm run demo

demo-postgres:
	pnpm run demo:postgres

demo-k8s:
	pnpm run demo:k8s

demo-efd:
	pnpm run demo:efd

bench:
	pnpm run bench:run

study:
	pnpm run study

analyze:
	pnpm run analyze

microbench:
	pnpm run microbench

clean:
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name "dist" -type d -prune -exec rm -rf '{}' +
	find . -name ".turbo" -type d -prune -exec rm -rf '{}' +
