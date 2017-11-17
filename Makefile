default: clean build

PHONY: clean
clean:
	-rm -r dist/

build: dist/build/uMatrix.chromium dist/build/uMatrix.firefox
	@echo All done. Find your builds in: $^

dist/build/uMatrix.chromium:
	tools/make-chromium.sh

dist/build/uMatrix.firefox:
	tools/make-firefox.sh

