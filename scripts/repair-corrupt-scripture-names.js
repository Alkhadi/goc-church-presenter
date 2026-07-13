/*
 * Repair corrupt scripture display names (e.g. "Acts 4,12 - NKJVCundefinedbTN") in the FreeShow
 * shows index (shows.json). These names were produced by an older code path; the current source is
 * already guarded, so this only cleans EXISTING saved display names.
 *
 * SAFETY:
 *  - Audit mode is the DEFAULT (read-only). Pass --repair to actually modify.
 *  - Repair mode creates a timestamped backup of every file it modifies BEFORE writing.
 *  - Only display names containing the literal tokens "undefined"/"null" are touched.
 *  - Bible text, verse content and licensing data are never modified (only show display names).
 *  - .show files are only rewritten if they actually contain the same corrupt names.
 *
 * Usage:
 *   node scripts/repair-corrupt-scripture-names.js                 (audit only, read-only)
 *   node scripts/repair-corrupt-scripture-names.js --repair        (backup + repair)
 *   node scripts/repair-corrupt-scripture-names.js --file="C:\\path\\to\\shows.json" [--repair]
 *   node scripts/repair-corrupt-scripture-names.js --shows-dir="C:\\path\\to\\Shows" [--repair]
 */

const fs = require("fs")
const path = require("path")

const REPAIR = process.argv.includes("--repair")

function argValue(name) {
    const arg = process.argv.find((a) => a.startsWith(name + "="))
    return arg ? arg.slice(name.length + 1).replace(/^"|"$/g, "") : ""
}

function defaultShowsJson() {
    const appData = process.env.APPDATA || ""
    const candidates = [path.join(appData, "FreeShow", "shows.json"), path.join(appData, "GOC Church Presenter", "shows.json")]
    return candidates.find((p) => p && fs.existsSync(p)) || ""
}

// The authoritative .show files live under the configured data path (config.json -> showsPath, or
// dataPath/Shows). shows.json (the index) is rebuilt from these, so the .show files must be repaired too.
function defaultShowsDir() {
    const appData = process.env.APPDATA || ""
    for (const cfgPath of [path.join(appData, "FreeShow", "config.json"), path.join(appData, "GOC Church Presenter", "config.json")]) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"))
            if (cfg.showsPath && fs.existsSync(cfg.showsPath)) return cfg.showsPath
            if (cfg.dataPath) {
                const d = path.join(cfg.dataPath, "Shows")
                if (fs.existsSync(d)) return d
            }
        } catch {
            /* ignore */
        }
    }
    return ""
}

function sanitizeFileName(name) {
    // FreeShow uses the show name directly as the filename; strip characters invalid on Windows.
    // eslint-disable-next-line no-control-regex
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim()
}

// Clean a corrupt name while preserving the leading version code.
// "Acts 4,12 - NKJVCundefinedbTN"    -> "Acts 4,12 - NKJV"
// "John 1,14 - NKJVCundefinedbTN 2"  -> "John 1,14 - NKJV 2"
function cleanName(name) {
    if (typeof name !== "string" || !/undefined|null/i.test(name)) return name
    const cleaned = name
        .replace(/([A-Za-z0-9]{2,}?)C?undefined[A-Za-z]*/g, "$1")
        .replace(/([A-Za-z0-9]{2,}?)null[A-Za-z]*/g, "$1")
        .replace(/undefined/gi, "")
        .replace(/\bnull\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    return cleaned || name
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-")
}

function backup(filePath) {
    const bak = `${filePath}.${timestamp()}.bak`
    fs.copyFileSync(filePath, bak)
    return bak
}

function repairShowsIndex(filePath) {
    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw)

    const changes = []
    for (const [id, entry] of Object.entries(data || {})) {
        if (entry && typeof entry.name === "string" && /undefined|null/i.test(entry.name)) {
            const newName = cleanName(entry.name)
            if (newName !== entry.name) changes.push({ id, oldName: entry.name, newName })
        }
    }

    console.log(`\nShows index: ${filePath}`)
    console.log(`  entries with corrupt names: ${changes.length}`)
    for (const c of changes) console.log(`    ${c.id}\n      old: "${c.oldName}"\n      new: "${c.newName}"`)

    if (!changes.length) return { changed: 0, backup: null }

    if (!REPAIR) {
        console.log("  (audit only — pass --repair to apply)")
        return { changed: 0, backup: null }
    }

    const bak = backup(filePath)
    console.log(`  backup created: ${bak}`)
    for (const c of changes) data[c.id].name = c.newName
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8")
    console.log(`  repaired ${changes.length} name(s).`)
    return { changed: changes.length, backup: bak }
}

// Repair .show files whose name (filename and/or internal "name") contains "undefined"/"null".
// Fixes the internal name AND renames the file to match, with a per-file timestamped backup.
function repairShowFiles(dir) {
    if (!dir || !fs.existsSync(dir)) {
        console.log(`  Shows folder not found: ${dir || "(none)"}`)
        return { scanned: 0, changed: 0, found: 0 }
    }
    let scanned = 0
    let changed = 0
    let found = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".show")) continue
        scanned++
        const full = path.join(dir, entry.name)
        let parsed
        try {
            parsed = JSON.parse(fs.readFileSync(full, "utf8"))
        } catch {
            continue
        }
        const show = Array.isArray(parsed) ? parsed[1] : parsed
        const nameCorrupt = show && typeof show.name === "string" && /undefined|null/i.test(show.name)
        const fileCorrupt = /undefined|null/i.test(entry.name)
        if (!nameCorrupt && !fileCorrupt) continue

        found++
        const oldName = (show && typeof show.name === "string" && show.name) || entry.name.replace(/\.show$/i, "")
        const newName = cleanName(oldName)
        console.log(`  ${entry.name}`)
        console.log(`      old name: "${oldName}"`)
        console.log(`      new name: "${newName}"`)
        if (!REPAIR) continue

        const bak = backup(full)
        console.log(`      backup:   ${bak}`)

        if (show && typeof show.name === "string") show.name = newName
        fs.writeFileSync(full, JSON.stringify(parsed), "utf8")

        const target = path.join(dir, sanitizeFileName(newName) + ".show")
        if (path.resolve(target) !== path.resolve(full)) {
            if (fs.existsSync(target)) {
                console.log(`      NOTE: target filename exists, kept content fix but did not rename: ${path.basename(target)}`)
            } else {
                fs.renameSync(full, target)
                console.log(`      renamed:  ${path.basename(target)}`)
            }
        }
        changed++
    }
    return { scanned, changed, found }
}

function main() {
    const showsJson = argValue("--file") || defaultShowsJson()
    const showsDir = argValue("--shows-dir") || defaultShowsDir()

    console.log(`Mode: ${REPAIR ? "REPAIR (will modify with backups)" : "AUDIT ONLY (read-only)"}`)

    // Repair the authoritative .show files first (the index is rebuilt from these).
    console.log(`\nScanning .show files in: ${showsDir || "(not found)"}`)
    const showResult = repairShowFiles(showsDir)
    console.log(`  .show files scanned: ${showResult.scanned}, corrupt: ${showResult.found}, changed: ${showResult.changed}`)

    // Also clean the shows.json index for immediate effect (the app would otherwise rebuild it from .show).
    if (showsJson && fs.existsSync(showsJson)) {
        repairShowsIndex(showsJson)
    } else {
        console.log("\nshows.json index not found; skipped.")
    }

    console.log(`\nDone. ${REPAIR ? "Repair applied (backups created)." : "No changes made (audit only)."}`)
}

try {
    main()
} catch (err) {
    console.error("Repair script failed:", err && err.message ? err.message : err)
    process.exitCode = 2
}
