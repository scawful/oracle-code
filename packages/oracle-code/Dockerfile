FROM alpine

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++
ADD ./dist/ocode-linux-x64-baseline-musl/bin/ocode /usr/local/bin/ocode
RUN ocode --version
ENTRYPOINT ["ocode"]
