import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { promisify } from 'node:util'

import { installMacOSIcon } from './macos-icon.js'

const execFileAsync = promisify(execFile)
const bundleRoot = mkdtempSync(join(tmpdir(), 'tastecode-icon-test-'))

after(() => rmSync(bundleRoot, { recursive: true, force: true }))

/** A bundle with the parts the icon installer writes to. */
function makeBundle(name) {
  const bundle = join(bundleRoot, `${name}.app`)
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict></dict></plist>\n',
  )
  return bundle
}

describe('the macOS app icon', () => {
  it('lands in the bundle, with or without actool', { skip: process.platform !== 'darwin' }, async () => {
    const bundle = makeBundle('with-icon')
    await installMacOSIcon(bundle)

    const icon = join(bundle, 'Contents', 'Resources', 'icon.icns')
    const { stdout } = await execFileAsync('/usr/bin/file', [icon])
    assert.match(stdout, /PNG data|icns/i)

    const { stdout: plist } = await execFileAsync('/usr/bin/plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      join(bundle, 'Contents', 'Info.plist'),
    ])
    assert.equal(plist.trim(), 'icon.icns')
  })

  it('compiles the asset catalog when actool is there', { skip: process.platform !== 'darwin' }, async () => {
    const bundle = makeBundle('with-assets')
    await installMacOSIcon(bundle)

    const car = join(bundle, 'Contents', 'Resources', 'Assets.car')
    if (!existsSync(car)) {
      // No full Xcode on this Mac: the icns is all the bundle gets.
      assert.ok(existsSync(join(bundle, 'Contents', 'Resources', 'icon.icns')))
      return
    }
    assert.ok(statSync(car).size > 0)
  })

  it('leaves a bundle alone on other platforms', { skip: process.platform === 'darwin' }, async () => {
    const bundle = makeBundle('untouched')
    await installMacOSIcon(bundle)
    assert.equal(
      readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8').includes('CFBundleIconFile'),
      false,
    )
  })
})
