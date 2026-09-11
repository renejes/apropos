import fs from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  disableIncompatibleSdkNatives,
  isVendoredTreeSitterProbe,
  nodeMajor,
  resetElectronSdkNativeGuardForTests,
  shouldDisableSdkTreeSitter,
} from './electron-natives'

describe('Electron-SDK-Natives', () => {
  let dir: string | undefined

  afterEach(() => {
    resetElectronSdkNativeGuardForTests()
    Object.defineProperty(process.versions, 'electron', {
      value: undefined,
      configurable: true,
    })
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('liest die Node-Hauptversion', () => {
    expect(nodeMajor('20.18.3')).toBe(20)
    expect(nodeMajor('22.22.1')).toBe(22)
  })

  it('deaktiviert tree-sitter nur in Electron unter Node 22', () => {
    expect(shouldDisableSdkTreeSitter(undefined, '20.18.3')).toBe(false)
    expect(shouldDisableSdkTreeSitter('39.8.10', '22.22.1')).toBe(false)
    expect(shouldDisableSdkTreeSitter('33.4.11', '20.18.3')).toBe(true)
  })

  it('erkennt nur die vendored tree-sitter-Pfade', () => {
    expect(isVendoredTreeSitterProbe('/x/vendor/tree-sitter/index.js')).toBe(true)
    expect(isVendoredTreeSitterProbe('/x/vendor/tree-sitter/binding.node')).toBe(true)
    expect(isVendoredTreeSitterProbe('/x/vendor/tree-sitter-bash/binding.node')).toBe(true)
    expect(isVendoredTreeSitterProbe('C:\\x\\vendor\\tree-sitter\\index.js')).toBe(true)
    expect(isVendoredTreeSitterProbe('/x/node_modules/better-sqlite3/build/Release/better_sqlite3.node')).toBe(
      false
    )
  })

  it('ist ohne Electron ein No-Op', () => {
    dir = mkdtempSync(join(tmpdir(), 'rop-ts-'))
    const fake = join(dir, 'vendor', 'tree-sitter', 'index.js')
    fs.mkdirSync(join(dir, 'vendor', 'tree-sitter'), { recursive: true })
    writeFileSync(fake, 'module.exports = {}\n')
    Object.defineProperty(process.versions, 'electron', { value: undefined, configurable: true })
    disableIncompatibleSdkNatives()
    expect(fs.existsSync(fake)).toBe(true)
  })

  it('blendet den Vendor-Index in Electron aus', () => {
    dir = mkdtempSync(join(tmpdir(), 'rop-ts-'))
    const fake = join(dir, 'vendor', 'tree-sitter', 'index.js')
    fs.mkdirSync(join(dir, 'vendor', 'tree-sitter'), { recursive: true })
    writeFileSync(fake, 'module.exports = {}\n')
    Object.defineProperty(process.versions, 'electron', { value: '1.0.0', configurable: true })
    disableIncompatibleSdkNatives()
    expect(fs.existsSync(fake)).toBe(nodeMajor() < 22 ? false : true)
    expect(fs.existsSync(join(process.cwd(), 'package.json'))).toBe(true)
  })
})
