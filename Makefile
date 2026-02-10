.PHONY: build test lint clean help install compile package

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: compile ## Build the extension

compile: ## Compile TypeScript
	npm run compile

test: compile ## Run tests
	npm test

lint: ## Run linting
	npm run lint

clean: ## Clean build artifacts
	rm -rf out/ node_modules/.cache

package: compile ## Package as VSIX
	npm run package

watch: ## Watch mode for development
	npm run watch
