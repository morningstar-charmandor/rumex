import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { DockAppRequest, DockAppResult } from '../shared/types'

/**
 * Generates a wrapper .app bundle for one context, giving it its own Dock
 * tile, name and icon.
 *
 * The bundle is an APFS copy-on-write clone (`cp -c`) of the running app's
 * bundle — instant to create and sharing disk blocks with the original, so it
 * costs almost no space. A symlinked Frameworks directory is NOT an option:
 * Electron SIGTRAPs on startup when Contents/Frameworks resolves outside the
 * bundle. The clone's app code is replaced with a small stub that pins the
 * context env vars and requires the real compiled main entry.
 *
 * Only the display name, bundle id and icon are changed in the plist — the
 * executable name and CFBundleName are left untouched, because Electron
 * derives its Helper app names from them and renaming breaks the
 * "Unable to find helper app" lookup in the packaged build. Separate Dock
 * tiles come from the unique CFBundleIdentifier, not from the executable name.
 */
export function createDockApp(request: DockAppRequest): DockAppResult {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Dock apps are only supported on macOS for now' }
  }
  try {
    const appsDir = join(app.getPath('home'), 'Applications', 'Rumex Apps')
    const safeName = request.contextName.replace(/[/:]+/g, '-').trim() || 'Space'
    const bundle = join(appsDir, `${safeName}.app`)
    // Assemble in a temp bundle, then swap it into place. Cloning straight
    // onto an existing (possibly running) bundle can merge into it and leave a
    // corrupt tree (e.g. app.asar becoming a directory) — the EISDIR failures.
    const work = join(appsDir, `.${safeName}.building.app`)
    const contents = join(work, 'Contents')
    const resourcesDir = join(contents, 'Resources')
    const stubDir = join(resourcesDir, 'app')
    const plistPath = join(contents, 'Info.plist')

    // e.g. …/node_modules/electron/dist/Electron.app (dev) or the installed
    // Rumex.app (packaged).
    const sourceBundle = resolve(process.execPath, '..', '..', '..')

    mkdirSync(appsDir, { recursive: true })
    rmSync(work, { recursive: true, force: true })
    execFileSync('cp', ['-Rc', sourceBundle, work], { stdio: 'ignore' })

    // Replace the app payload with the context stub. The stub's package name
    // must match the main app's so Chromium's cookie-encryption key (Keychain
    // item "<name> Safe Storage") stays the same — otherwise copied sessions
    // could not be decrypted. app.asar must be removed so Electron loads the
    // stub in Resources/app instead of the packaged app (asar takes
    // precedence); recursive covers a stale bundle where it is a directory.
    rmSync(stubDir, { recursive: true, force: true })
    rmSync(join(resourcesDir, 'app.asar'), { recursive: true, force: true })
    rmSync(join(resourcesDir, 'app.asar.unpacked'), { recursive: true, force: true })
    mkdirSync(stubDir, { recursive: true })
    const entry = join(app.getAppPath(), 'out', 'main', 'index.js')
    writeFileSync(
      join(stubDir, 'package.json'),
      JSON.stringify({
        name: 'rumex',
        productName: 'rumex',
        version: app.getVersion() || '0.1.0',
        main: 'index.js',
        private: true
      })
    )
    writeFileSync(
      join(stubDir, 'index.js'),
      [
        `process.env.CW_CONTEXT_ID = ${JSON.stringify(request.contextId)}`,
        `process.env.CW_CONTEXT_NAME = ${JSON.stringify(request.contextName)}`,
        `process.env.CW_MAIN_USERDATA = ${JSON.stringify(app.getPath('userData'))}`,
        `require(${JSON.stringify(entry)})`,
        ''
      ].join('\n')
    )

    buildIcns(request.iconPngBase64, join(resourcesDir, 'icon.icns'))

    const plutil = (key: string, value: string): void => {
      execFileSync('plutil', ['-replace', key, '-string', value, plistPath], { stdio: 'ignore' })
    }
    plutil('CFBundleIdentifier', `com.rumex.client.${request.contextId}`)
    plutil('CFBundleDisplayName', safeName)
    plutil('CFBundleIconFile', 'icon.icns')

    execFileSync('codesign', ['--force', '--sign', '-', work], { stdio: 'ignore' })

    // Swap the freshly built bundle into place.
    rmSync(bundle, { recursive: true, force: true })
    renameSync(work, bundle)

    return { ok: true, path: bundle }
  } catch (error) {
    // A half-built temp bundle is cleared by the rmSync(work) at the start of
    // the next attempt, so no destructive cleanup is needed here.
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 1024px PNG → .icns via the stock macOS sips + iconutil tools. */
function buildIcns(pngBase64: string, outIcns: string): void {
  const tmp = join(app.getPath('temp'), `cw-icon-${Date.now()}`)
  const iconset = join(tmp, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  try {
    const base = join(tmp, 'base.png')
    writeFileSync(base, Buffer.from(pngBase64, 'base64'))
    const sizes: [string, number][] = [
      ['16x16', 16],
      ['16x16@2x', 32],
      ['32x32', 32],
      ['32x32@2x', 64],
      ['128x128', 128],
      ['128x128@2x', 256],
      ['256x256', 256],
      ['256x256@2x', 512],
      ['512x512', 512],
      ['512x512@2x', 1024]
    ]
    for (const [label, px] of sizes) {
      execFileSync(
        'sips',
        ['-z', String(px), String(px), base, '--out', join(iconset, `icon_${label}.png`)],
        { stdio: 'ignore' }
      )
    }
    execFileSync('iconutil', ['-c', 'icns', '-o', outIcns, iconset], { stdio: 'ignore' })
    if (!existsSync(outIcns)) throw new Error('icon conversion failed')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
