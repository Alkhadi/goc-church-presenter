/*
 * Durable OPUS rebuild for Electron.
 *
 * @discordjs/opus ships/builds a Node-ABI native binary during `npm install`, but Electron
 * needs an Electron-ABI binary. Without it the app logs "OPUS not found!" and audio streaming
 * (Icecast/NDI/Blackmagic) is disabled. `electron-builder install-app-deps` does not reliably
 * produce the Electron-targeted binary for this package, so we rebuild it explicitly here using
 * the package's own @discordjs/node-pre-gyp, targeting the installed Electron version.
 *
 * This runs from `postinstall`. OPUS is OPTIONAL: this script always exits 0 (even on failure)
 * so that a missing/failed audio binary never breaks `npm install`. Real errors are printed.
 */

const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const LABEL = "[rebuild-opus-electron]"

function log(msg) {
    console.log(`${LABEL} ${msg}`)
}
function warn(msg) {
    console.warn(`${LABEL} ${msg}`)
}

function resolveDir(pkgJson) {
    try {
        return path.dirname(require.resolve(pkgJson, { paths: [process.cwd(), __dirname] }))
    } catch {
        return null
    }
}

function main() {
    // 1. Detect Electron version dynamically (never hard-coded)
    let electronVersion
    try {
        electronVersion = require("electron/package.json").version
    } catch (err) {
        warn("Electron is not installed; skipping OPUS rebuild (OPUS is optional).")
        warn(`Reason: ${err && err.message ? err.message : err}`)
        return
    }
    log(`Detected Electron version: ${electronVersion}`)

    // 2. Locate @discordjs/opus
    const opusDir = resolveDir("@discordjs/opus/package.json")
    if (!opusDir || !fs.existsSync(opusDir)) {
        warn("@discordjs/opus is not installed; skipping OPUS rebuild (OPUS is optional).")
        return
    }
    log(`Found @discordjs/opus at: ${opusDir}`)

    // 3. Locate @discordjs/node-pre-gyp executable (bin/node-pre-gyp)
    let nodePreGypDir = resolveDir("@discordjs/node-pre-gyp/package.json")
    let nodePreGypBin = nodePreGypDir ? path.join(nodePreGypDir, "bin", "node-pre-gyp") : null

    // fall back to a copy nested under @discordjs/opus if it was not hoisted
    if (!nodePreGypBin || !fs.existsSync(nodePreGypBin)) {
        const nested = path.join(opusDir, "node_modules", "@discordjs", "node-pre-gyp", "bin", "node-pre-gyp")
        if (fs.existsSync(nested)) nodePreGypBin = nested
    }

    if (!nodePreGypBin || !fs.existsSync(nodePreGypBin)) {
        warn("@discordjs/node-pre-gyp executable not found; cannot rebuild OPUS (OPUS is optional).")
        return
    }
    log(`Found node-pre-gyp at: ${nodePreGypBin}`)

    // 4. Rebuild for the Electron runtime
    const args = [nodePreGypBin, "rebuild", "--runtime=electron", `--target=${electronVersion}`, "--dist-url=https://electronjs.org/headers"]
    log(`Rebuilding OPUS for Electron ${electronVersion} ...`)

    const result = spawnSync(process.execPath, args, {
        cwd: opusDir,
        stdio: "inherit"
    })

    if (result.error) {
        warn("OPUS Electron rebuild failed to start. Audio streaming will be unavailable until fixed.")
        warn(`Error: ${result.error.message}`)
        return
    }

    if (result.status !== 0) {
        warn(`OPUS Electron rebuild exited with code ${result.status}. Audio streaming will be unavailable until fixed.`)
        return
    }

    log("OPUS Electron rebuild succeeded. Audio streaming binary is ready.")
}

try {
    main()
} catch (err) {
    // Never break `npm install` for optional audio support, but surface the real error.
    warn("Unexpected error during OPUS rebuild (OPUS is optional).")
    warn(`Error: ${err && err.stack ? err.stack : err}`)
}

// Always succeed so npm install does not fail for optional audio support.
process.exit(0)
