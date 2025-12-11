#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@oracle-code/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/ocode --version`)
  await $`./dist/${name}/bin/ocode --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tags = [Script.channel]

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod 755 -R .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  for (const tag of tags) {
    await $`npm publish *.tgz --access public --tag ${tag}`.cwd(`./dist/${name}`)
  }
})
await Promise.all(tasks)
for (const tag of tags) {
  await $`cd ./dist/${pkg.name} && bun pm pack && npm publish *.tgz --access public --tag ${tag}`
}

if (!Script.preview) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`cd dist/${key}/bin && tar -czf ../../${key}.tar.gz *`
    } else {
      await $`cd dist/${key}/bin && zip -r ../../${key}.zip *`
    }
  }

  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/ocode-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/ocode-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/ocode-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/ocode-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='oracle-code-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/scawful/oracle-code'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('oracle-code')",
    "conflicts=('oracle-code')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/scawful/oracle-code/releases/download/v\${pkgver}\${_subver}/ocode-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/scawful/oracle-code/releases/download/v\${pkgver}\${_subver}/ocode-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./ocode "${pkgdir}/usr/bin/ocode"',
    "}",
    "",
  ].join("\n")

  // Source-based PKGBUILD for oracle-code
  const sourcePkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='oracle-code'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/scawful/oracle-code'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('oracle-code')",
    "conflicts=('oracle-code-bin')",
    "depends=('ripgrep')",
    "makedepends=('git' 'bun-bin' 'go')",
    "",
    `source=("oracle-code-\${pkgver}.tar.gz::https://github.com/scawful/oracle-code/archive/v\${pkgver}\${_subver}.tar.gz")`,
    `sha256sums=('SKIP')`,
    "",
    "build() {",
    `  cd "oracle-code-\${pkgver}"`,
    `  bun install`,
    "  cd ./packages/oracle-code",
    `  OCODE_CHANNEL=latest OCODE_VERSION=${pkgver} bun run ./script/build.ts --single`,
    "}",
    "",
    "package() {",
    `  cd "oracle-code-\${pkgver}/packages/oracle-code"`,
    '  mkdir -p "${pkgdir}/usr/bin"',
    '  target_arch="x64"',
    '  case "$CARCH" in',
    '    x86_64) target_arch="x64" ;;',
    '    aarch64) target_arch="arm64" ;;',
    '    *) printf "unsupported architecture: %s\\n" "$CARCH" >&2 ; return 1 ;;',
    "  esac",
    '  libc=""',
    "  if command -v ldd >/dev/null 2>&1; then",
    "    if ldd --version 2>&1 | grep -qi musl; then",
    '      libc="-musl"',
    "    fi",
    "  fi",
    '  if [ -z "$libc" ] && ls /lib/ld-musl-* >/dev/null 2>&1; then',
    '    libc="-musl"',
    "  fi",
    '  base=""',
    '  if [ "$target_arch" = "x64" ]; then',
    "    if ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then",
    '      base="-baseline"',
    "    fi",
    "  fi",
    '  bin="dist/ocode-linux-${target_arch}${base}${libc}/bin/ocode"',
    '  if [ ! -f "$bin" ]; then',
    '    printf "unable to find binary for %s%s%s\\n" "$target_arch" "$base" "$libc" >&2',
    "    return 1",
    "  fi",
    '  install -Dm755 "$bin" "${pkgdir}/usr/bin/ocode"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [
    ["oracle-code-bin", binaryPkgbuild],
    ["oracle-code", sourcePkgbuild],
  ]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch (e) {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class OracleCode < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://github.com/scawful/oracle-code"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/scawful/oracle-code/releases/download/v${Script.version}/ocode-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "ocode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/scawful/oracle-code/releases/download/v${Script.version}/ocode-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "ocode"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/scawful/oracle-code/releases/download/v${Script.version}/ocode-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "ocode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/scawful/oracle-code/releases/download/v${Script.version}/ocode-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "ocode"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone https://${process.env["GITHUB_TOKEN"]}@github.com/sst/homebrew-tap.git ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/oracle-code.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add oracle-code.rb`
  await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
  await $`cd ./dist/homebrew-tap && git push`

  const image = "ghcr.io/scawful/oracle-code"
  await $`docker build -t ${image}:${Script.version} .`
  await $`docker push ${image}:${Script.version}`
  await $`docker tag ${image}:${Script.version} ${image}:latest`
  await $`docker push ${image}:latest`
}
