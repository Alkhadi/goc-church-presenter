/*
 * AUDIT-ONLY: report shows whose name / slide group / reference contains a literal
 * "undefined" or "null" token (e.g. corrupted scripture names like "NKJVCundefinedbTN").
 *
 * This script is READ-ONLY. It never writes, renames, or deletes any file.
 * It only prints a report so a human can decide whether a separate, approved
 * repair is warranted.
 *
 * Usage:
 *   node scripts/audit-scripture-names.js --dir="C:\\path\\to\\Shows"
 *
 * If --dir is omitted it tries the default FreeShow/GOC data "Shows" folder under APPDATA.
 */

const fs = require("fs")
const path = require("path")

// literal broken tokens we care about. "undefined" can appear embedded between
// other characters (e.g. "NKJVCundefinedbTN"), so it is matched as a substring.
// "null" is matched on a word boundary to avoid false positives inside real words.
const BROKEN = /undefined|\bnull\b/i

function getDirArg() {
    const arg = process.argv.find((a) => a.startsWith("--dir="))
    if (arg) return arg.slice("--dir=".length).replace(/^"|"$/g, "")

    // best-effort default locations (never guessed for writing, only for reading)
    const appData = process.env.APPDATA || ""
    const candidates = [path.join(appData, "FreeShow", "Shows"), path.join(appData, "GOC Church Presenter", "Shows")]
    return candidates.find((p) => p && fs.existsSync(p)) || ""
}

function listShowFiles(dir) {
    const out = []
    const walk = (d) => {
        let entries = []
        try {
            entries = fs.readdirSync(d, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = path.join(d, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".show")) out.push(full)
        }
    }
    walk(dir)
    return out
}

function auditShow(filePath) {
    let raw
    try {
        raw = fs.readFileSync(filePath, "utf8")
    } catch {
        return null
    }

    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { file: filePath, id: "", name: "", issues: ["<invalid JSON, skipped>"] }
    }

    const id = Array.isArray(parsed) ? parsed[0] : ""
    const show = Array.isArray(parsed) ? parsed[1] : parsed
    if (!show || typeof show !== "object") return null

    const issues = []

    if (typeof show.name === "string" && BROKEN.test(show.name)) issues.push(`name: "${show.name}"`)

    const ref = show.reference && show.reference.data
    if (ref && typeof ref.version === "string" && BROKEN.test(ref.version)) issues.push(`reference.version: "${ref.version}"`)

    if (show.slides && typeof show.slides === "object") {
        for (const [slideId, slide] of Object.entries(show.slides)) {
            if (slide && typeof slide.group === "string" && BROKEN.test(slide.group)) {
                issues.push(`slide[${slideId}].group: "${slide.group}"`)
            }
        }
    }

    if (!issues.length) return null
    return { file: filePath, id, name: show.name || "", issues }
}

// Scan the shows index (shows.json) which maps show id -> { name, category, ... }.
// Corrupt scripture names (e.g. "NKJVCundefinedbTN") persist here from older imports.
function auditShowsIndex(indexPath) {
    if (!indexPath || !fs.existsSync(indexPath)) return null

    let parsed
    try {
        parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    } catch {
        return { file: indexPath, entries: [], note: "<invalid JSON, skipped>" }
    }

    const entries = []
    for (const [id, entry] of Object.entries(parsed || {})) {
        if (entry && typeof entry.name === "string" && BROKEN.test(entry.name)) {
            entries.push({ id, name: entry.name })
        }
    }
    return { file: indexPath, entries }
}

function getIndexArg() {
    const arg = process.argv.find((a) => a.startsWith("--index="))
    if (arg) return arg.slice("--index=".length).replace(/^"|"$/g, "")
    const appData = process.env.APPDATA || ""
    const candidates = [path.join(appData, "FreeShow", "shows.json"), path.join(appData, "GOC Church Presenter", "shows.json")]
    return candidates.find((p) => p && fs.existsSync(p)) || ""
}

function main() {
    const dir = getDirArg()
    if (!dir || !fs.existsSync(dir)) {
        console.error("Shows folder not found. Pass one explicitly:")
        console.error('  node scripts/audit-scripture-names.js --dir="C:\\path\\to\\Shows"')
        process.exitCode = 1
        return
    }

    const files = listShowFiles(dir)
    console.log(`Scanning ${files.length} .show file(s) in: ${dir}`)
    console.log("(read-only — no files will be modified)\n")

    const affected = []
    for (const file of files) {
        const result = auditShow(file)
        if (result) affected.push(result)
    }

    if (!affected.length) {
        console.log("No shows with literal 'undefined'/'null' in name, group, or reference were found.")
    } else {
        console.log(`Found ${affected.length} show(s) with suspicious names/groups:\n`)
        for (const a of affected) {
            console.log(`- ${path.basename(a.file)}`)
            console.log(`    id:   ${a.id}`)
            console.log(`    name: ${a.name}`)
            for (const issue of a.issues) console.log(`    > ${issue}`)
            console.log("")
        }
    }

    // Also scan the shows index (shows.json)
    const indexPath = getIndexArg()
    const indexResult = auditShowsIndex(indexPath)
    console.log("")
    if (!indexResult) {
        console.log("Shows index (shows.json) not found; skipped. Pass one with --index=\"C:\\path\\to\\shows.json\".")
    } else if (indexResult.note) {
        console.log(`Shows index ${indexResult.file}: ${indexResult.note}`)
    } else if (!indexResult.entries.length) {
        console.log(`Shows index ${indexResult.file}: no suspicious names found.`)
    } else {
        console.log(`Shows index ${indexResult.file}: ${indexResult.entries.length} suspicious name(s):`)
        for (const e of indexResult.entries) console.log(`    ${e.id}  >  "${e.name}"`)
    }

    console.log("\nThis report is informational only. No repair has been performed.")
}

main()
