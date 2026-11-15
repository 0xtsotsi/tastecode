import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const iconSourcePath = path.resolve(here, '../assets/tastecode-icon.icon')
const iconPngPath = path.resolve(here, '../assets/tastecode-app-icon.png')

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

async function buildIcnsWithoutActool(outputPath) {
  const iconsetDirectory = `${outputPath}.iconset`
  await mkdir(iconsetDirectory, { recursive: true })
  for (const [name, size] of iconsetSizes) {
    const target = path.join(iconsetDirectory, name)
    await execFileAsync('/usr/bin/sips', [
      '-z',
      String(size),
      String(size),
      iconPngPath,
      '--out',
      target,
    ])
  }
  await execFileAsync('/usr/bin/iconutil', ['-c', 'icns', iconsetDirectory, '-o', outputPath])
  await rm(iconsetDirectory, { recursive: true, force: true })
}

async function setPlistString(plistPath, key, value) {
  try {
    await execFileAsync('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath])
  } catch {
    await execFileAsync('/usr/bin/plutil', ['-insert', key, '-string', value, plistPath])
  }
}

export async function installMacOSIcon(appBundle) {
  if (process.platform !== 'darwin') return

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tastecode-icon-'))
  const iconDocument = path.join(temporaryDirectory, 'Icon.icon')
  const outputDirectory = path.join(temporaryDirectory, 'out')

  try {
    await Promise.all([
      cp(iconSourcePath, iconDocument, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
    ])

    const resourcesDirectory = path.join(appBundle, 'Contents', 'Resources')
    await mkdir(resourcesDirectory, { recursive: true })
    const plistPath = path.join(appBundle, 'Contents', 'Info.plist')

    let usedFallback = false
    try {
      await execFileAsync('xcrun', [
        'actool',
        iconDocument,
        '--compile',
        outputDirectory,
        '--output-format',
        'human-readable-text',
        '--notices',
        '--warnings',
        '--output-partial-info-plist',
        path.join(outputDirectory, 'assetcatalog_generated_info.plist'),
        '--app-icon',
        'Icon',
        '--include-all-app-icons',
        '--accent-color',
        'AccentColor',
        '--enable-on-demand-resources',
        'NO',
        '--development-region',
        'en',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        '26.0',
        '--platform',
        'macosx',
      ])
    } catch (error) {
      // actool ships with the full Xcode app, not with the Command Line Tools.
      // Fall back to a plain icns so the dev bundle still gets an icon.
      usedFallback = true
      console.warn('[desktop] actool unavailable, building the icon with iconutil instead')
      const icnsPath = path.join(outputDirectory, 'Icon.icns')
      await buildIcnsWithoutActool(icnsPath)
      await copyFile(icnsPath, path.join(resourcesDirectory, 'icon.icns'))
      await setPlistString(plistPath, 'CFBundleIconFile', 'icon.icns')
    }

    if (!usedFallback) {
      await Promise.all([
        copyFile(
          path.join(outputDirectory, 'Assets.car'),
          path.join(resourcesDirectory, 'Assets.car'),
        ),
        copyFile(path.join(outputDirectory, 'Icon.icns'), path.join(resourcesDirectory, 'icon.icns')),
      ])

      await setPlistString(plistPath, 'CFBundleIconFile', 'icon.icns')
      await setPlistString(plistPath, 'CFBundleIconName', 'Icon')
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
