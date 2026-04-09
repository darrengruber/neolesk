-include .env
export

.PHONY: dev build deploy test test-engines test-exports

dev:
	cd expo-app && npm run examples:cache && npm run web

build:
	cd expo-app && npm run examples:cache && npx expo export --platform web

deploy:
	wrangler pages deploy expo-app/dist --project-name neolesk

test: test-engines test-exports

test-engines:
	cd expo-app && npm run test:engines

test-exports:
	cd expo-app && npm run test:exports
