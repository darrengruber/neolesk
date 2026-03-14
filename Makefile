-include .env
export

.PHONY: dev build deploy

dev:
	cd expo-app && npm run web

build:
	cd expo-app && npm run examples:cache && npx expo export --platform web

deploy:
	wrangler pages deploy expo-app/dist --project-name neolesk
