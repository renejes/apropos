import fs from 'node:fs'

/**
 * @cursor/sdk liefert tree-sitter für Node ≥ 22. Electron mit älterem Node
 * (nicht die Cursor-IDE) gibt bei require(binding.node) SIGSEGV, nicht fangbar.
 * Ohne diese Dateien fällt das SDK auf „shell command analysis disabled“ zurück.
 * Electron mit Node ≥ 22 darf die Natives laden.
 */
const TREE_SITTER_PROBE = /\/vendor\/tree-sitter(?:-bash)?\/(?:index\.js|binding\.node)$/
const SDK_MIN_NODE_MAJOR = 22

const origExistsSync = fs.existsSync.bind(fs)
const origDlopen = process.dlopen.bind(process)

let applied = false

export function isVendoredTreeSitterProbe(path: string): boolean {
  return TREE_SITTER_PROBE.test(path.replace(/\\/g, '/'))
}

export function nodeMajor(version = process.versions.node): number {
  const n = Number(version.split('.')[0])
  return Number.isFinite(n) ? n : 0
}

export function shouldDisableSdkTreeSitter(
  electron = process.versions.electron,
  node = process.versions.node
): boolean {
  if (!electron) return false
  return nodeMajor(node) < SDK_MIN_NODE_MAJOR
}

/** Einmalig: tree-sitter-Natives nicht laden, wenn Electron unter Node 22 läuft. */
export function disableIncompatibleSdkNatives(): void {
  if (applied) return
  if (!shouldDisableSdkTreeSitter()) return
  applied = true

  fs.existsSync = ((path: fs.PathLike) => {
    if (isVendoredTreeSitterProbe(String(path))) return false
    return origExistsSync(path)
  }) as typeof fs.existsSync

  process.dlopen = ((module: object, filename: string, flags?: number) => {
    if (isVendoredTreeSitterProbe(filename)) {
      const err = new Error(
        'tree-sitter ist in Electron deaktiviert (Node-ABI). Shell-Analyse aus.'
      ) as NodeJS.ErrnoException
      err.code = 'ERR_DLOPEN_FAILED'
      throw err
    }
    return flags === undefined ? origDlopen(module, filename) : origDlopen(module, filename, flags)
  }) as typeof process.dlopen
}

export function resetElectronSdkNativeGuardForTests(): void {
  if (!applied) return
  fs.existsSync = origExistsSync
  process.dlopen = origDlopen
  applied = false
}
