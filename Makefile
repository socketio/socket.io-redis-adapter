
REPORTER = dot

test:
	@./node_modules/.bin/mocha \
		--reporter $(REPORTER) \
		--slow 4000ms \
		--timeout 10000ms \
		--bail

.PHONY: test
