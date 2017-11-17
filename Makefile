default: clean build

PHONY: clean
clean:
	-rm -r dist/

PHONY: build
build:
	tools/make-firefox.sh
	tools/make-chromium.sh

